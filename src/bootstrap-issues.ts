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

    // Normalize issue dates
    constants.normalizeIssueDates(issues);

    // Find the minimum date for processing
    let minDate = new Date();
    for (const issue of issues) {
        if (new Date(issue.createdAt) < minDate) {
            minDate = new Date(issue.createdAt);
        }
    }

    const dataMap = new Map<string, Record<string, constants.AreaSnapshotRollup>>();
    const uniqueAreas = constants.getUniqueAreas(issues);

    // Set up date range
    const today = new Date();
    today.setHours(23, 59, 59, 999); // Set to end of day to ensure we include today

    const startDate = new Date(minDate);
    startDate.setHours(0, 0, 0, 0); // Set to start of day

    // Process all dates from start to today
    constants.processDateRange(issues, startDate, today, dataMap, uniqueAreas);

    console.log(`✅ Completed rollup processing for all dates from ${startDate.toISOString().split('T')[0]} to ${today.toISOString().split('T')[0]}`);

    // Update last rollup run date
    const nowIso = new Date().toISOString();
    console.log(`✅ Updated last rollup run date to ${nowIso}`);

    // Convert dataMap to output format
    const outputData = constants.convertDataMapToOutput(dataMap);

    // Create complete output with all issue lists
    const completeOutput = constants.createCompleteOutput(issues, outputData);

    await fs.promises.writeFile(
        path.join(constants.projectRoot, OUT_JSON), 
        JSON.stringify(completeOutput, null, 2), 
        'utf-8'
    );
    console.log(`✅ Written rollup data to ${OUT_JSON}`);
}

main().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
});