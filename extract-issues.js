const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

let repoName = process.argv[2];
if (!repoName) {
  console.error("Usage: node index.js <repo-name>");
  console.error("Example: node index.js owner/repo");
  process.exit(1);
}

function executeGhCommand(command) {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = command.split(" ");
    const child = spawn(cmd, args);

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (error) => {
      console.error(`Error executing command: ${command}`);
      console.error(error.message);
      process.exit(1);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        console.error(`Command failed with code ${code}: ${command}`);
        console.error(stderr);
        process.exit(1);
      } else {
        try {
          resolve(JSON.parse(stdout));
        } catch (err) {
          console.error("Failed to parse JSON output");
          console.error(stdout);
          process.exit(1);
        }
      }
    });
  });
}

function getTotalReactions(reactionGroups) {
  if (!reactionGroups) return 0;

  return reactionGroups.reduce((total, group) => {
    return total + (group.users?.totalCount || 0);
  }, 0);
}

function escapeCsvField(value) {
  if (value === null || value === undefined) return "";
  const str = value.toString().replace(/"/g, '""');
  return `"${str}"`;
}

async function main() {
  console.log(`🔍 Fetching all issues from GitHub for ${repoName}...`);

  let allIssues = await executeGhCommand(
    `gh issue list --limit 999999 --state all --json number,title,author,labels,state,createdAt,closedAt,reactionGroups,url,comments --repo ${repoName}`
  );

  console.log(`📋 Found ${allIssues.length} issues in ${repoName}`);

  const issues = allIssues.map((issue) => {
    const labels = issue.labels.map((label) => label.name);

    // Find all area labels (can be multiple)
    const areaLabels = labels.filter((label) => label.startsWith("Area - "));
    const areas = areaLabels.map((label) => label.replace("Area - ", ""));

    // Find type label
    const isBug = labels.includes("Bug");
    const isFeature = labels.includes("Enhancement");

    let type = null;
    if (isBug && isFeature) {
      type = "Both Bug and Feature"; // Edge case
    } else if (isBug) {
      type = "Bug";
    } else if (isFeature) {
      type = "Feature Request";
    }

    const totalReactions = getTotalReactions(issue.reactionGroups);

    return {
      author: issue.author.login,
      closedAt: issue.closedAt,
      createdAt: issue.createdAt,
      number: issue.number,
      state: issue.state,
      url: issue.url,
      title: issue.title,
      areas,
      type,
      hasArea: areas.length > 0,
      hasType: !!type,
      totalReactions,
      commentCount: issue.comments.length,
    };
  });

  const rows = [];

  issues.forEach((issue) => {
    if (issue.areas.length === 0) {
      const row = [
        issue.number,
        issue.title,
        issue.author,
        issue.state,
        issue.createdAt,
        issue.closedAt,
        "",
        issue.type,
        issue.totalReactions,
        issue.url,
        issue.commentCount
      ];
      rows.push(row);
    } else {
      issue.areas.forEach((area) => {
        const row = [
          issue.number,
          issue.title,
          issue.author,
          issue.state,
          issue.createdAt,
          issue.closedAt,
          area,
          issue.type,
          issue.totalReactions,
          issue.url,
          issue.commentCount
        ];
        rows.push(row);
      });
    }
  });

  console.log(`✅ Processed ${issues.length} issues with areas and types`);

  // write this as json file
  const issuesFilePath = path.join(
    __dirname,
    `${repoName.replace("/", "-")}-all-issues.json`
  );
  fs.writeFileSync(issuesFilePath, JSON.stringify(issues, null, 2));
  console.log(`✅ All issues saved to ${issuesFilePath}`);

  const csvFilePath = path.join(
    __dirname,
    `${repoName.replace("/", "-")}-issues.csv`
  );

  const header = [
    "Number",
    "Title",
    "Author",
    "State",
    "CreatedAt",
    "ClosedAt",
    "Area",
    "Type",
    "Reactions",
    "URL",
    "Comments"
  ];

  const csvContent =
    header.join(",") +
    "\n" +
    rows.map((row) => row.map(escapeCsvField).join(",")).join("\n");

  fs.writeFileSync(csvFilePath, csvContent, "utf-8");
  console.log(`✅ CSV file written to ${csvFilePath}`);
}

main();
