import * as constants from './constants';
import path from 'path';
import { parse } from 'ts-command-line-args';
import fs from 'fs';

export type IncrementalArguments = {
    inputPath: string;
    //dbPath: string;
    chartsPath: string;
    help?: boolean;
};

export const args = parse<IncrementalArguments>({
    inputPath: { type: String, description: 'Path to input JSON file (issues)' },
    //dbPath: { type: String, description: 'Path to SQLite database file' },
    chartsPath: { type: String, description: 'Path to charts JSON file to update' },
    help: { type: Boolean, optional: true }
});

const INPUT_PATH = args.inputPath;
//const DB_PATH = args.dbPath;
const CHARTS_PATH = args.chartsPath;

// Check if required files exist
if (!fs.existsSync(path.join(constants.projectRoot, INPUT_PATH))) {
    console.error(`Input file not found: ${INPUT_PATH}`);
    process.exit(1);
}

// if (!fs.existsSync(path.join(constants.projectRoot, DB_PATH))) {
//     console.error(`Database file not found: ${DB_PATH}`);
//     process.exit(1);
// }

if (!fs.existsSync(path.join(constants.projectRoot, CHARTS_PATH))) {
    console.error(`Charts file not found: ${CHARTS_PATH}`);
    process.exit(1);
}

//const database = new BetterSqlite3(path.join(constants.projectRoot, DB_PATH));

function getLastSnapshotDate(chartsData: any): string | null {
    const chartDates = Object.keys(chartsData.charts || {});
    if (chartDates.length === 0) return null;

    // Sort dates and get the latest
    chartDates.sort();
    const lastDate = chartDates[chartDates.length - 1];
    return lastDate || null;
}

function getNextDate(dateStr: string): string {
    const date = new Date(dateStr);
    date.setDate(date.getDate() + 1);
    const result = date.toISOString().split('T')[0];
    return result!; // Safe because toISOString().split('T')[0] always returns a string
}

async function main() {
    console.log('🔄 Starting incremental update...');

    // Load existing charts data
    const chartsFileContent = await fs.promises.readFile(path.join(constants.projectRoot, CHARTS_PATH), 'utf-8');
    const existingChartsData = JSON.parse(chartsFileContent);

    // Load latest issues data
    const inputFileContent = await fs.promises.readFile(path.join(constants.projectRoot, INPUT_PATH), 'utf-8');
    const issues = JSON.parse(inputFileContent) as constants.Issue[];
    console.log(`✅ Loaded ${issues.length} issues from ${INPUT_PATH}`);

    // Normalize dates
    for (const issue of issues) {
        issue.createdAt = new Date(issue.createdAt).toISOString();
        if (issue.closedAt) {
            issue.closedAt = new Date(issue.closedAt).toISOString();
        }
    }

    // Get the last snapshot date from charts
    const lastSnapshotDate = getLastSnapshotDate(existingChartsData);
    if (!lastSnapshotDate) {
        console.error('No existing snapshot data found in charts file. Please run bootstrap first.');
        process.exit(1);
    }

    console.log(`📅 Last snapshot date: ${lastSnapshotDate}`);

    // Calculate date range for incremental update
    const startDate = getNextDate(lastSnapshotDate);
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    const startDateObj = new Date(startDate);
    startDateObj.setHours(0, 0, 0, 0);

    if (startDateObj > today) {
        console.log('✅ Charts are already up to date!');
        return;
    }

    console.log(`🔄 Updating from ${startDate} to ${today.toISOString().split('T')[0]}`);

    // Ensure database tables exist
    // database.exec(`
    //     PRAGMA journal_mode = WAL;
    //     PRAGMA synchronous = NORMAL;

    //     CREATE TABLE IF NOT EXISTS snapshots_rollup (
    //         snapshotDate     TEXT,
    //         area             TEXT,
    //         open             INTEGER,
    //         untriaged        INTEGER,
    //         triaged          INTEGER,
    //         backlog          INTEGER,
    //         opened_last_30d  INTEGER,
    //         closed_last_30d  INTEGER,
    //         bucket_0_7       INTEGER,
    //         bucket_8_30      INTEGER,
    //         bucket_31_90     INTEGER,
    //         bucket_91_180    INTEGER,
    //         bucket_180_plus  INTEGER,
    //         PRIMARY KEY (snapshotDate, area)
    //     );

    //     CREATE TABLE IF NOT EXISTS last_rollup_run (
    //         id              INTEGER PRIMARY KEY,
    //         lastRunDate     TEXT
    //     );

    //     CREATE INDEX IF NOT EXISTS idx_rollup_date ON snapshots_rollup(snapshotDate);
    //     CREATE INDEX IF NOT EXISTS idx_rollup_area ON snapshots_rollup(area);
    // `);

    // Prepare statements
    //const upsertRollup = database.prepare(constants.upsertSnapshotQuery);
    //const updateLastRun = database.prepare(constants.UpdateLastRollupRunQuery);

    // Get unique areas from issues
    const uniqueAreas = new Set<string>();
    issues.forEach(issue => {
        issue.areas.forEach(area => uniqueAreas.add(area));
    });
    uniqueAreas.add(constants.ALL_AREAS_LABEL);

    // Process incremental dates
    const dataMap = new Map<string, Record<string, constants.AreaSnapshotRollup>>();

    for (let date = new Date(startDateObj); date <= today;) {
        const snapshotDate: string = date.toISOString().split('T')[0]!; // Safe assertion
        console.log(`📊 Processing snapshot for: ${snapshotDate}`);

        if (!dataMap.has(snapshotDate)) {
            dataMap.set(snapshotDate, {});
        }

        const areaRecords = dataMap.get(snapshotDate)!;

        // Initialize area records
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

        // Process each issue for the current snapshot date
        issues.forEach(issue => {
            const createdAtDate = new Date(issue.createdAt);
            const closedAtDate = issue.closedAt ? new Date(issue.closedAt) : null;
            const snapshotDateObj = new Date(snapshotDate);

            // Check if issue is open on snapshot date
            const isOpen = createdAtDate <= snapshotDateObj && (!closedAtDate || closedAtDate > snapshotDateObj) && issue.milestone !== constants.BACKLOG_MILESTONE;

            // Check if issue was created in the last 30 days
            const openedInLast30Days = createdAtDate > new Date(snapshotDateObj.getTime() - 30 * 24 * 60 * 60 * 1000) && createdAtDate <= snapshotDateObj;

            // Check if issue was closed in the last 30 days
            const closedInLast30Days = closedAtDate && closedAtDate > new Date(snapshotDateObj.getTime() - 30 * 24 * 60 * 60 * 1000) && closedAtDate <= snapshotDateObj;

            // Determine age bucket
            const ageBucket = constants.getAgeBucket(snapshotDateObj, issue.createdAt);

            // Areas to update
            const areasToUpdate = issue.areas.length > 0 ? issue.areas : [];
            areasToUpdate.push(constants.ALL_AREAS_LABEL);

            areasToUpdate.forEach(area => {
                const record = areaRecords[area]!;

                if (isOpen) {
                    record.open += 1;

                    (record as any)[ageBucket] += 1;
                }
                if (issue.milestone === constants.BACKLOG_MILESTONE && issue.state === 'OPEN') {
                    record.backlog += 1;
                }
                if (issue.areas.length === 0) {
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

        // Upsert rollup records for the current snapshot date
        const areaRecordsToInsert = dataMap.get(snapshotDate)!;
        for (const [area, rollup] of Object.entries(areaRecordsToInsert)) {
            // upsertRollup.run({
            //     snapshotDate,
            //     area,
            //     ...rollup
            // });
        }

        // Move to next day
        date.setDate(date.getDate() + 1);
    }

    // Update last run date
    const nowIso = new Date().toISOString();
    // updateLastRun.run({
    //     lastRunDate: nowIso
    // });
    console.log(`✅ Updated last rollup run date to ${nowIso}`);

    // Merge new data with existing charts data
    const newChartsData: constants.AreaSnapshotRollupOutput[] = [];
    dataMap.forEach((value, key) => {
        for (const [area, rollup] of Object.entries(value)) {
            newChartsData.push({
                date: key,
                area,
                ...rollup
            });
        }
    });

    // Update the existing charts data
    const updatedChartsData = {
        ...existingChartsData.charts,
        ...newChartsData
    };

    // Update the special issue lists with latest data
    const mostReactedIssues = constants.mostReactedIssues(issues);
    const mostCommentedIssues = constants.mostCommentedIssues(issues);
    const noAreaIssues = constants.noAreaIssues(issues);
    const noMilestoneIssues = constants.noMilestoneIssues(issues);
    const backlogIssues = constants.backlogIssues(issues);

    // Write updated data to charts file
    const finalOutput = {
        mostReactedIssues,
        mostCommentedIssues,
        noAreaIssues,
        noMilestoneIssues,
        backlogIssues,
        charts: updatedChartsData,
    };

    await fs.promises.writeFile(
        path.join(constants.projectRoot, CHARTS_PATH),
        JSON.stringify(finalOutput, null, 2),
        'utf-8'
    );

    console.log(`✅ Updated charts data in ${CHARTS_PATH}`);
    console.log(`📊 Added ${Object.keys(newChartsData).length} new snapshot dates`);
    console.log(`🔄 Incremental update completed successfully!`);

    //database.close();
}

main().catch((error) => {
    console.error("Error:", error);
    //database.close();
    process.exit(1);
});