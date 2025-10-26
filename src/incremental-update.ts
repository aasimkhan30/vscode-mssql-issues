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
    const charts = chartsData.charts || [];
    if (charts.length === 0) return null;

    // Get all unique dates and sort them
    const chartDates = Array.from(new Set(charts.map((entry: any) => entry.date))).sort();
    
    // Return the latest date
    const lastDate = chartDates[chartDates.length - 1];
    return typeof lastDate === 'string' ? lastDate : null;
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
    constants.normalizeIssueDates(issues);

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

    // Get unique areas from issues
    const uniqueAreas = constants.getUniqueAreas(issues);

    // Process incremental dates
    const dataMap = new Map<string, Record<string, constants.AreaSnapshotRollup>>();
    
    // Process the date range
    constants.processDateRange(issues, startDateObj, today, dataMap, uniqueAreas);

    // Update last run date
    const nowIso = new Date().toISOString();
    console.log(`✅ Updated last rollup run date to ${nowIso}`);

    // Convert new data to output format
    const newChartsData = constants.convertDataMapToOutput(dataMap);

    // Merge existing charts with new charts data
    const existingCharts = existingChartsData.charts || [];
    const mergedCharts = [...existingCharts, ...newChartsData];

    // Create the complete output with updated data
    const finalOutput = constants.createCompleteOutput(issues, mergedCharts);

    await fs.promises.writeFile(
        path.join(constants.projectRoot, CHARTS_PATH),
        JSON.stringify(finalOutput, null, 2),
        'utf-8'
    );

    console.log(`✅ Updated charts data in ${CHARTS_PATH}`);
    console.log(`📊 Added ${newChartsData.length} new snapshot records`);
    console.log(`🔄 Incremental update completed successfully!`);
}

main().catch((error) => {
    console.error("Error:", error);
    //database.close();
    process.exit(1);
});