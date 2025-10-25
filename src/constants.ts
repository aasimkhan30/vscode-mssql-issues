import * as path from 'path';

export const projectRoot = path.join(__dirname, '..');

export interface Issue {
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
    totalReactions: number;
    commentCount: number;
    milestone: string | null;
}

export interface AreaSnapshotRollup {
    open: number;
    untriaged: number;
    backlog: number;
    opened_last_30d: number;
    closed_last_30d: number;
    bucket_0_7: number;
    bucket_8_30: number;
    bucket_31_90: number;
    bucket_91_180: number;
    bucket_180_plus: number;
}

export interface AreaSnapshotRollupOutput extends AreaSnapshotRollup {
    date: string;
    area: string;
}

export const upsertSnapshotQuery = `
    INSERT INTO snapshots_rollup
            (snapshotDate, area, open, untriaged, triaged, backlog,
            opened_last_30d, closed_last_30d,
            bucket_0_7, bucket_8_30, bucket_31_90, bucket_91_180, bucket_180_plus)
            VALUES (@snapshotDate, @area, @open, @untriaged, @triaged, @backlog,
                    @opened_last_30d, @closed_last_30d,
                    @bucket_0_7, @bucket_8_30, @bucket_31_90, @bucket_91_180, @bucket_180_plus)
            ON CONFLICT(snapshotDate, area) DO UPDATE SET
                open=excluded.open,
                untriaged=excluded.untriaged,
                triaged=excluded.triaged,
                backlog=excluded.backlog,
                opened_last_30d=excluded.opened_last_30d,
                closed_last_30d=excluded.closed_last_30d,
                bucket_0_7=excluded.bucket_0_7,
                bucket_8_30=excluded.bucket_8_30,
                bucket_31_90=excluded.bucket_31_90,
                bucket_91_180=excluded.bucket_91_180,
                bucket_180_plus=excluded.bucket_180_plus;
`;

export const UpdateLastRollupRunQuery = `
    INSERT INTO last_rollup_run (id, lastRunDate)
    VALUES (1, @lastRunDate)
    ON CONFLICT(id) DO UPDATE SET
        lastRunDate=excluded.lastRunDate;
`;

export const ALL_AREAS_LABEL = "Area - All"

export const BACKLOG_MILESTONE = "Backlog";

export const AGE_BUCKETS = [
    { key: "bucket_0_7", min: 0, max: 7 },
    { key: "bucket_8_30", min: 8, max: 30 },
    { key: "bucket_31_90", min: 31, max: 90 },
    { key: "bucket_91_180", min: 91, max: 180 },
    { key: "bucket_180_plus", min: 181, max: Infinity }
];

export const getAgeBucket = (baseDate: Date, createdAt: string): string => {
    const createdDate = new Date(createdAt);
    const ageInDays = (baseDate.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24);

    for (const bucket of AGE_BUCKETS) {
        if (ageInDays >= bucket.min && ageInDays <= bucket.max) {
            return bucket.key;
        }
    }
    return "unknown";
}

export const mostCommentedIssues = (issues: Issue[]): Issue[] => {
    return issues
        .filter(issue => issue.commentCount > 0 && issue.state === 'OPEN')
        .sort((a, b) => b.commentCount - a.commentCount)
        .slice(0, 100);
}

export const mostReactedIssues = (issues: Issue[]): Issue[] => {
    return issues
        .filter(issue => issue.totalReactions > 0 && issue.state === 'OPEN')
        .sort((a, b) => b.totalReactions - a.totalReactions)
        .slice(0, 100);
}

export const noAreaIssues = (issues: Issue[]): Issue[] => {
    return issues.filter(issue => issue.areas.length === 0 && issue.state === 'OPEN');
}

export const noMilestoneIssues = (issues: Issue[]): Issue[] => {
    return issues.filter(issue => issue.milestone === null && issue.state === 'OPEN');
}

export const backlogIssues = (issues: Issue[]): Issue[] => {
    return issues.filter(issue => issue.milestone === BACKLOG_MILESTONE && issue.state === 'OPEN');
}

// Common processing functions to reduce redundancy

/**
 * Normalizes issue dates to ISO strings
 */
export const normalizeIssueDates = (issues: Issue[]): void => {
    for (const issue of issues) {
        issue.createdAt = new Date(issue.createdAt).toISOString();
        if (issue.closedAt) {
            issue.closedAt = new Date(issue.closedAt).toISOString();
        }
    }
}

/**
 * Gets unique areas from issues and adds the ALL_AREAS_LABEL
 */
export const getUniqueAreas = (issues: Issue[]): Set<string> => {
    const uniqueAreas = new Set<string>();
    issues.forEach(issue => {
        issue.areas.forEach(area => uniqueAreas.add(area));
    });
    uniqueAreas.add(ALL_AREAS_LABEL);
    return uniqueAreas;
}

/**
 * Initializes an empty area record with all metrics set to zero
 */
export const createEmptyAreaRecord = (): AreaSnapshotRollup => {
    return {
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

/**
 * Initializes area records for all unique areas on a specific date
 */
export const initializeAreaRecords = (
    dataMap: Map<string, Record<string, AreaSnapshotRollup>>,
    snapshotDate: string,
    uniqueAreas: Set<string>
): Record<string, AreaSnapshotRollup> => {
    if (!dataMap.has(snapshotDate)) {
        dataMap.set(snapshotDate, {});
    }

    const areaRecords = dataMap.get(snapshotDate)!;

    uniqueAreas.forEach(area => {
        if (!areaRecords[area]) {
            areaRecords[area] = createEmptyAreaRecord();
        }
    });

    return areaRecords;
}

/**
 * Gets the areas to update for an issue (includes ALL_AREAS_LABEL)
 */
export const getAreasToUpdate = (issue: Issue): string[] => {
    const areas = issue.areas && issue.areas.length > 0 ? [...issue.areas] : [];
    areas.push(ALL_AREAS_LABEL);
    return Array.from(new Set(areas)); // Remove duplicates
}

/**
 * Processes a single issue for a specific snapshot date and updates area records
 */
export const processIssueForSnapshot = (
    issue: Issue,
    snapshotDate: string,
    areaRecords: Record<string, AreaSnapshotRollup>
): void => {
    const createdAtDate = new Date(issue.createdAt);
    const closedAtDate = issue.closedAt ? new Date(issue.closedAt) : null;
    const snapshotDateObj = new Date(snapshotDate);

    // Check if issue is open on snapshot date
    const isOpen = createdAtDate <= snapshotDateObj && (!closedAtDate || closedAtDate > snapshotDateObj);

    const isTriaged = isOpen && issue.milestone !== BACKLOG_MILESTONE;

    // Check if issue was created in the last 30 days from snapshot date
    const openedInLast30Days = createdAtDate > new Date(snapshotDateObj.getTime() - 30 * 24 * 60 * 60 * 1000) && createdAtDate <= snapshotDateObj;

    // Check if issue was closed in the last 30 days from snapshot date
    const closedInLast30Days = closedAtDate && closedAtDate > new Date(snapshotDateObj.getTime() - 30 * 24 * 60 * 60 * 1000) && closedAtDate <= snapshotDateObj;

    // Determine age bucket
    const ageBucket = getAgeBucket(snapshotDateObj, issue.createdAt);

    // Areas to update
    const areasToUpdate = getAreasToUpdate(issue);

    areasToUpdate.forEach(area => {
        const record = areaRecords[area]!;

        if (isTriaged) {
            record.open += 1;
            (record as any)[ageBucket] += 1;
        }
        if (issue.milestone === BACKLOG_MILESTONE && isOpen) {
            record.backlog += 1;
        }
        if ((issue.milestone === undefined || issue.milestone === null) && isOpen) {
            record.untriaged += 1;
        }
        if (openedInLast30Days) {
            record.opened_last_30d += 1;
        }
        if (closedInLast30Days) {
            record.closed_last_30d += 1;
        }
    });
}

/**
 * Converts dataMap to output format
 */
export const convertDataMapToOutput = (
    dataMap: Map<string, Record<string, AreaSnapshotRollup>>
): AreaSnapshotRollupOutput[] => {
    const outputData: AreaSnapshotRollupOutput[] = [];
    
    dataMap.forEach((areaRecords, snapshotDate) => {
        for (const [area, rollup] of Object.entries(areaRecords)) {
            outputData.push({
                date: snapshotDate,
                area,
                ...rollup
            });
        }
    });

    return outputData;
}

/**
 * Creates the complete output object with all issue lists and charts
 */
export const createCompleteOutput = (issues: Issue[], charts: AreaSnapshotRollupOutput[]) => {
    return {
        mostReactedIssues: mostReactedIssues(issues),
        mostCommentedIssues: mostCommentedIssues(issues),
        noAreaIssues: noAreaIssues(issues),
        noMilestoneIssues: noMilestoneIssues(issues),
        backlogIssues: backlogIssues(issues),
        charts,
    };
}

/**
 * Processes all issues for a date range and populates the dataMap
 */
export const processDateRange = (
    issues: Issue[],
    startDate: Date,
    endDate: Date,
    dataMap: Map<string, Record<string, AreaSnapshotRollup>>,
    uniqueAreas: Set<string>
): void => {
    for (let date = new Date(startDate); date <= endDate;) {
        const snapshotDate = date.toISOString().split('T')[0] as string;
        
        // Initialize area records for this date
        const areaRecords = initializeAreaRecords(dataMap, snapshotDate, uniqueAreas);

        // Process each issue for the current snapshot date
        issues.forEach(issue => {
            processIssueForSnapshot(issue, snapshotDate, areaRecords);
        });

        console.log(`✅ Processed snapshot for date: ${snapshotDate}`);

        // Move to next day
        date.setDate(date.getDate() + 1);
    }
}