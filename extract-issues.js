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

const baseFields = "number,title,author,state,createdAt,closedAt,url";
const labelFields = "number,labels";
const commentsField = "number,comments";
const reactionsField = "number,reactionGroups";

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

async function fetchIssues(fields) {
  const command = `gh issue list --limit 999999 --state all --json ${fields} --repo ${repoName}`;
  const batch = await executeGhCommand(command);
  return batch;
}

async function fetchComments(fields) {
  const command = `gh api --paginate repos/${repoName}/issues -q '[.[] | select(.pull_request | not) | {number, comments}]'`;
  const batch = await executeGhCommand(command);
  return batch;
}

async function waitForSeconds(seconds) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, seconds * 1000);
  });
}

async function main() {
  console.log(`🔍 Fetching all issues from GitHub for ${repoName}...`);

  console.log(`📦 Fetching base issue info...`);
  const baseIssues = await fetchIssues(baseFields);
  console.log(`📦 Fetching labels...`);
  const labelData = await fetchIssues(labelFields);
  console.log(`💬 Fetching comments...`);
  const commentData = await fetchComments(commentsField);
  console.log(`🎉 Fetching reactions...`);
  const reactionData = await fetchIssues(reactionsField);

  const commentsMap = new Map(commentData.map((i) => [i.number, i.comments]));
  const reactionsMap = new Map(
    reactionData.map((i) => [i.number, i.reactionGroups])
  );
  const labelsMap = new Map(
    labelData.map((i) => [i.number, i.labels])
  );

  const allIssues = baseIssues.map((issue) => ({
    ...issue,
    comments: commentsMap.get(issue.number) ?? 0,
    reactionGroups: reactionsMap.get(issue.number) ?? [],
    labels: labelsMap.get(issue.number) ?? [],
  }));

  console.log(`📋 Found ${allIssues.length} issues in ${repoName}`);

  const issues = allIssues.map((issue) => {
    console.log(issue);
    const labels = issue.labels.map((label) => label.name);

    // Find all area labels (can be multiple)
    const areaLabels = labels.filter((label) => label.startsWith("Area - "));
    const areas = areaLabels.map((label) => label.replace("Area - ", ""));
    const priorityLabel = labels.filter((label) => label.startsWith("Pri:"))[0];

    let priority = undefined;
    if (priorityLabel) {
      priority = parseInt(priorityLabel.replace("Pri: ", ""));
    } else {
      priority = -1;
    }

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
      priority,
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
        issue.commentCount,
        issue.priority,
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
          issue.commentCount,
          issue.priority,
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
    "Comments",
    "Priority",
  ];

  const csvContent =
    header.join(",") +
    "\n" +
    rows.map((row) => row.map(escapeCsvField).join(",")).join("\n");

  fs.writeFileSync(csvFilePath, csvContent, "utf-8");
  console.log(`✅ CSV file written to ${csvFilePath}`);
}

main();
