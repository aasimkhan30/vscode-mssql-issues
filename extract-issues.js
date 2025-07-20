const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

let repoName = process.argv[2];
if (!repoName) {
  console.error("Usage: node index.js <repo-name>");
  console.error("Example: node index.js owner/repo");
  process.exit(1);
}

// Helper function to execute gh commands
function executeGhCommand(command) {
  try {
    const result = execSync(command, { encoding: "utf8" });
    return JSON.parse(result);
  } catch (error) {
    console.error(`Error executing command: ${command}`);
    console.error(error.message);
    process.exit(1);
  }
}

function getTotalReactions(reactionGroups) {
  if (!reactionGroups) return 0;

  return reactionGroups.reduce((total, group) => {
    return total + (group.users?.totalCount || 0);
  }, 0);
}

function main() {
  console.log(`🔍 Fetching all issues from GitHub for ${repoName}...`);

  let allIssues = executeGhCommand(
    `gh issue list --limit 999999 --state all --json number,title,labels,state,createdAt,closedAt,reactionGroups,url --repo ${repoName}`
  );

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
      ...issue,
      areas,
      type,
      hasArea: areas.length > 0,
      hasType: !!type,
      totalReactions,
    };
  });

  // write this as json file
  const all_issuesJSON = path.join(__dirname, "all_issues.json");
  fs.writeFileSync(all_issuesJSON, JSON.stringify(issues, null, 2));
  console.log(`✅ All issues saved to ${all_issuesJSON}`);  
}


main();
