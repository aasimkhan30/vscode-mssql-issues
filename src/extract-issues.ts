import { execSync, spawn, ChildProcessWithoutNullStreams } from "child_process";
import fs from "fs";
import path from "path";

interface Author {
  login: string;
}

interface Milestone {
  title: string;
}

interface Label {
  name: string;
}

interface ReactionGroup {
  users?: {
    totalCount: number;
  };
}

interface BaseIssue {
  number: number;
  title: string;
  author: Author;
  state: string;
  createdAt: string;
  closedAt: string | null;
  url: string;
  milestone?: Milestone;
}

interface IssueWithLabels {
  number: number;
  labels: Label[];
}

interface IssueWithReactions {
  number: number;
  reactionGroups: ReactionGroup[];
}

interface CommentData {
  number: number;
  comments: number;
}

interface ProcessedIssue {
  author: string;
  closedAt: string | null;
  createdAt: string;
  number: number;
  state: string;
  url: string;
  title: string;
  areas: string[];
  priority: number;
  type: string | null;
  hasArea: boolean;
  hasType: boolean;
  totalReactions: number;
  commentCount: number;
  milestone: string | undefined;
}

type CsvRow = (string | number | null | undefined)[];

const repoNameArg: string | undefined = process.argv[2];
if (!repoNameArg) {
  console.error("Usage: node index.js <repo-name>");
  console.error("Example: node index.js owner/repo");
  process.exit(1);
}

const repoName: string = repoNameArg;

const baseFields: string =
  "number,title,author,state,createdAt,closedAt,url,milestone";
const labelFields: string = "number,labels";
const reactionsField: string = "number,reactionGroups";

function executeGhJsonCommand(cmd: string, args: string[] = []): Promise<any> {
  return new Promise((resolve, reject) => {
    const child: ChildProcessWithoutNullStreams = spawn(cmd, args);
    let stdout: string = "";
    let stderr: string = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code: number | null) => {
      if (code !== 0) {
        return reject(new Error(`Command failed: ${stderr}`));
      }
      try {
        const result = JSON.parse(stdout);
        resolve(result);
      } catch (err) {
        reject(new Error(`Failed to parse JSON: ${(err as Error).message}`));
      }
    });
  });
}

function executeGhJsonStream(cmd: string, args: string[] = []): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const child: ChildProcessWithoutNullStreams = spawn(cmd, args);
    let stdout: string = "";
    let stderr: string = "";
    const results: any[] = [];

    const jsonArrayRegex = /\[\s*(?:{[\s\S]*?}\s*)*\]/g;

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();

      let match: RegExpExecArray | null;
      while ((match = jsonArrayRegex.exec(stdout)) !== null) {
        try {
          const parsed = JSON.parse(match[0]);
          if (Array.isArray(parsed)) {
            results.push(...parsed);
          }
        } catch (err) {
          // Log and continue; malformed chunk
          console.warn("Skipping malformed chunk");
        }
      }

      // Clean up parsed data from buffer
      stdout = stdout.slice(jsonArrayRegex.lastIndex);
      jsonArrayRegex.lastIndex = 0;
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code: number | null) => {
      // Try parsing remaining data
      if (stdout.trim()) {
        try {
          const parsed = JSON.parse(stdout);
          if (Array.isArray(parsed)) {
            results.push(...parsed);
          }
        } catch (e) {
          console.warn("Final leftover not parsed:", stdout);
        }
      }

      if (code !== 0) {
        return reject(new Error(`Command failed: ${stderr}`));
      }

      resolve(results);
    });
  });
}

function getTotalReactions(reactionGroups: ReactionGroup[]): number {
  if (!reactionGroups) return 0;

  return reactionGroups.reduce((total: number, group: ReactionGroup) => {
    return total + (group.users?.totalCount || 0);
  }, 0);
}

function escapeCsvField(value: any): string {
  if (value === null || value === undefined) return "";
  const str = value.toString().replace(/"/g, '""');
  return `"${str}"`;
}

async function fetchIssues<T = BaseIssue>(fields: string): Promise<T[]> {
  const batch = await executeGhJsonCommand("gh", [
    "issue",
    "list",
    "--limit",
    "999999",
    "--state",
    "all",
    "--json",
    fields,
    "--repo",
    repoName,
  ]);
  return batch;
}

async function fetchComments(): Promise<CommentData[]> {
  const output = await executeGhJsonStream("gh", [
    "api",
    "--paginate",
    `repos/${repoName}/issues?state=all`,
    "-q",
    "[.[] | select(.pull_request | not) | {number, comments}]",
  ]);
  return output;
}

async function main(): Promise<void> {
  console.log(`🔍 Fetching all issues from GitHub for ${repoName}...`);

  console.log(`📦 Fetching base issue info...`);
  const baseIssues: BaseIssue[] = await fetchIssues<BaseIssue>(baseFields);
  console.log(`📦 Fetching labels...`);
  const labelData: IssueWithLabels[] = await fetchIssues<IssueWithLabels>(labelFields);
  console.log(`💬 Fetching comments...`);
  const commentData: CommentData[] = await fetchComments();
  console.log(`🎉 Fetching reactions...`);
  const reactionData: IssueWithReactions[] = await fetchIssues<IssueWithReactions>(reactionsField);
  
  const commentsMap = new Map<number, number>(commentData.map((i) => [i.number, i.comments]));
  const reactionsMap = new Map<number, ReactionGroup[]>(
    reactionData.map((i) => [i.number, i.reactionGroups])
  );
  const labelsMap = new Map<number, Label[]>(labelData.map((i) => [i.number, i.labels]));

  const allIssues = baseIssues.map((issue) => ({
    ...issue,
    comments: commentsMap.get(issue.number) ?? 0,
    reactionGroups: reactionsMap.get(issue.number) ?? [],
    labels: labelsMap.get(issue.number) ?? [],
  }));

  console.log(`📋 Found ${allIssues.length} issues in ${repoName}`);

  const issues: ProcessedIssue[] = allIssues.map((issue) => {
    const labels: string[] = issue.labels.map((label) => label.name);

    // Find all area labels (can be multiple)
    const areaLabels: string[] = labels.filter((label) => label.startsWith("Area - "));
    const areas: string[] = areaLabels.map((label) => label.replace("Area - ", ""));
    const priorityLabel: string | undefined = labels.filter((label) => label.startsWith("Pri:"))[0];

    let priority: number;
    if (priorityLabel) {
      priority = parseInt(priorityLabel.replace("Pri: ", ""));
    } else {
      priority = -1;
    }

    // Find type label
    const isBug: boolean = labels.includes("Bug");
    const isFeature: boolean = labels.includes("Enhancement");

    let type: string | null = null;
    if (isBug && isFeature) {
      type = "Both Bug and Feature"; // Edge case
    } else if (isBug) {
      type = "Bug";
    } else if (isFeature) {
      type = "Feature Request";
    }

    const totalReactions: number = getTotalReactions(issue.reactionGroups);

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
      commentCount: issue.comments,
      milestone: issue.milestone?.title,
    };
  });

  const rows: CsvRow[] = [];

  issues.forEach((issue) => {
    if (issue.areas.length === 0) {
      const row: CsvRow = [
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
        issue.milestone,
      ];
      rows.push(row);
    } else {
      issue.areas.forEach((area) => {
        const row: CsvRow = [
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
          issue.milestone,
        ];
        rows.push(row);
      });
    }
  });

  console.log(`✅ Processed ${issues.length} issues with areas and types`);

  // write this as json file (save to project root, not dist folder)
  const projectRoot = path.join(__dirname, '..');
  const issuesFilePath: string = path.join(
    projectRoot,
    `${repoName.replace("/", "-")}-all-issues.json`
  );
  fs.writeFileSync(issuesFilePath, JSON.stringify(issues, null, 2));
  console.log(`✅ All issues saved to ${issuesFilePath}`);

  const csvFilePath: string = path.join(
    projectRoot,
    `${repoName.replace("/", "-")}-issues.csv`
  );

  const header: string[] = [
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
    "Milestone",
  ];

  const csvContent: string =
    header.join(",") +
    "\n" +
    rows.map((row) => row.map(escapeCsvField).join(",")).join("\n");

  fs.writeFileSync(csvFilePath, csvContent, "utf-8");
  console.log(`✅ CSV file written to ${csvFilePath}`);
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});