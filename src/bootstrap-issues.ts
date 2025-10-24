import * as constants from './constants';
import path from 'path';
//import BetterSqlite3 from 'better-sqlite3';
import { parse } from 'ts-command-line-args';
import fs from 'fs';

export type BootStrapArguments = {
    inputPath: string;
    //dbPath: string;
    outputPath: string;
    help?: boolean;
};

export const args = parse<BootStrapArguments>({
    inputPath: { type: String, description: 'Path to input JSON file' },
    //dbPath: { type: String, description: 'Path to SQLite database file' },
    outputPath: { type: String, description: 'Path to output JSON file' },
    help: { type: Boolean, optional: true }
});

const INPUT_PATH = args.inputPath;
//const DB_PATH = args.dbPath;
const OUT_JSON = args.outputPath;

// check if input file exists
if (!fs.existsSync(path.join(constants.projectRoot, INPUT_PATH))) {
    console.error(`Input file not found: ${INPUT_PATH}`);
    process.exit(1);
}

// check if database file exists

//const database = new BetterSqlite3(path.join(constants.projectRoot, DB_PATH));

async function main() {
    const inputFileContent = await fs.promises.readFile(path.join(constants.projectRoot, INPUT_PATH), 'utf-8');
    const issues = JSON.parse(inputFileContent) as constants.Issue[];
    console.log(`✅ Loaded ${issues.length} issues from ${INPUT_PATH}`);


    // convert closedAt and createdAt to UTC dates
    let minDate = new Date();
    for (const issue of issues) {
        issue.createdAt = new Date(issue.createdAt).toISOString();
        if (issue.closedAt) {
            issue.closedAt = new Date(issue.closedAt).toISOString();
        }
        if (new Date(issue.createdAt) < minDate) {
            minDate = new Date(issue.createdAt);
        }
    }

    // create snapshots_rollup table if not exists
    // database.exec(
    //     `
    //         PRAGMA journal_mode = WAL;
    //         PRAGMA synchronous = NORMAL;

    //         CREATE TABLE IF NOT EXISTS snapshots_rollup (
    //             snapshotDate     TEXT,
    //             area             TEXT,
    //             open             INTEGER,
    //             untriaged        INTEGER,
    //             triaged          INTEGER,
    //             backlog          INTEGER,
    //             opened_last_30d  INTEGER,
    //             closed_last_30d  INTEGER,
    //             bucket_0_7       INTEGER,
    //             bucket_8_30      INTEGER,
    //             bucket_31_90     INTEGER,
    //             bucket_91_180    INTEGER,
    //             bucket_180_plus  INTEGER,
    //             PRIMARY KEY (snapshotDate, area)
    //         );

    //         CREATE INDEX IF NOT EXISTS idx_rollup_date ON snapshots_rollup(snapshotDate);
    //         CREATE INDEX IF NOT EXISTS idx_rollup_area ON snapshots_rollup(area);

    //         CREATE TABLE IF NOT EXISTS last_rollup_run (
    //             id               INTEGER PRIMARY KEY,
    //             lastRunDate     TEXT
    //         );
    //     `
    // );

    // prepare upsert statement for snapshots_rollup
    //const upsertRollup = database.prepare(constants.upsertSnapshotQuery);

    const dataMap = new Map<string, Record<string, constants.AreaSnapshotRollup>>();

    const uniqueAreas = new Set<string>();
    issues.forEach(issue => {
        issue.areas.forEach(area => uniqueAreas.add(area));
    });
    uniqueAreas.add(constants.ALL_AREAS_LABEL);

    // iterate from minDate to today, one day at a time
    const today = new Date();
    today.setHours(23, 59, 59, 999); // Set to end of day to ensure we include today

    const startDate = new Date(minDate);
    startDate.setHours(0, 0, 0, 0); // Set to start of day

    for (let date = new Date(startDate); date <= today;) {
        const snapshotDate = date.toISOString().split('T')[0] as string;
        if (!dataMap.has(snapshotDate)) {
            dataMap.set(snapshotDate, {});
        }

        // --- populate dataMap with initial zeroed rollup records for each area ---
        const areaRecords = dataMap.get(snapshotDate)!;

        uniqueAreas.forEach(area => {
            if (!areaRecords[area]) {
                areaRecords[area] = {
                    open: 0,
                    untriaged: 0,
                    backlog: 0,
                    opened_last_30d: 0,
                    closed_last_30d: 0,
                    bucket_0_7: 0,
                    bucket_8_30: 0,
                    bucket_31_90: 0,
                    bucket_91_180: 0,
                    bucket_180_plus: 0
                };
            }
        });

        // --- process each issue for the current snapshotDate ---
        issues.forEach(issue => {
            const createdAtDate = new Date(issue.createdAt);
            const closedAtDate = issue.closedAt ? new Date(issue.closedAt) : null;
            const snapshotDateObj = new Date(snapshotDate);

            // Check if issue is open on snapshotDate
            const isOpen = createdAtDate <= snapshotDateObj && (!closedAtDate || closedAtDate > snapshotDateObj) && issue.milestone !== constants.BACKLOG_MILESTONE;

            // Check if issue was created in the last 30 days from snapshotDate
            const openedInLast30Days = createdAtDate > new Date(snapshotDateObj.getTime() - 30 * 24 * 60 * 60 * 1000) && createdAtDate <= snapshotDateObj;

            // Check if issue was closed in the last 30 days from snapshotDate
            const closedInLast30Days = closedAtDate && closedAtDate > new Date(snapshotDateObj.getTime() - 30 * 24 * 60 * 60 * 1000) && closedAtDate <= snapshotDateObj;

            // Determine age bucket
            const ageBucket = constants.getAgeBucket(snapshotDateObj, issue.createdAt);

            // Areas to update (including "Area - All")
            const areasToUpdate =
                issue.areas && issue.areas.length
                    ? Array.from(new Set([...issue.areas, constants.ALL_AREAS_LABEL]))
                    : [constants.ALL_AREAS_LABEL];

            areasToUpdate.forEach(area => {
                const record = areaRecords[area]!;

                if (isOpen) {
                    record.open += 1;
                    (record as any)[ageBucket] += 1;
                }
                if (issue.milestone === constants.BACKLOG_MILESTONE && issue.state === 'OPEN') {
                    record.backlog += 1;
                }
                if (issue.milestone === null) {
                    record.untriaged += 1;
                }
                if (openedInLast30Days) {
                    record.opened_last_30d += 1;
                }
                if (closedInLast30Days) {
                    record.closed_last_30d += 1;
                }

            });
        });

        // --- upsert rollup records for the current snapshotDate ---
        const areaRecordsToInsert = dataMap.get(snapshotDate)!;
        for (const [area, rollup] of Object.entries(areaRecordsToInsert)) {
            // upsertRollup.run({
            //     snapshotDate,
            //     area,
            //     ...rollup
            // });
        }
        console.log(`✅ Processed snapshot for date: ${snapshotDate}`);

        // Move to next day
        date.setDate(date.getDate() + 1);
    }
    console.log(`✅ Completed rollup processing for all dates from ${startDate.toISOString().split('T')[0]} to ${today.toISOString().split('T')[0]}`);


    // update last_rollup_run table
    // const updateLastRun = database.prepare(
    //     constants.UpdateLastRollupRunQuery
    // );
    const nowIso = new Date().toISOString();
    // updateLastRun.run({
    //     lastRunDate: nowIso
    // });
    console.log(`✅ Updated last rollup run date to ${nowIso}`);

    // write dataMap to output JSON file
    const outputData:
        constants.AreaSnapshotRollupOutput[]
        = [];
    dataMap.forEach((areaRecords, snapshotDate) => {
        for (const [area, rollup] of Object.entries(areaRecords)) {
            outputData.push({
                date: snapshotDate,
                area,
                ...rollup
            });
        }
    });

    // Get open issues with most reactions and elminate issues with no reactions
    const mostReactedIssues = constants.mostReactedIssues(issues);

    // Get open issues with most comments and elminate issues with no comments
    const mostCommentedIssues = constants.mostCommentedIssues(issues);

    // Get open issues with no areas
    const noAreaIssues = constants.noAreaIssues(issues);

    // Get open issues with no milestone
    const noMilestoneIssues = constants.noMilestoneIssues(issues);

    // Get open backlog issues
    const backlogIssues = constants.backlogIssues(issues);

    await fs.promises.writeFile(path.join(constants.projectRoot, OUT_JSON), JSON.stringify(
        {
            mostReactedIssues,
            mostCommentedIssues,
            noAreaIssues,
            noMilestoneIssues,
            backlogIssues,
            charts: outputData,
        }, null, 2), 'utf-8');
    console.log(`✅ Written rollup data to ${OUT_JSON}`);
}

main().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
});