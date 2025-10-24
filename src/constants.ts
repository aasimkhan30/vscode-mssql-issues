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
    triaged: number;
    backlog: number;
    opened_last_30d: number;
    closed_last_30d: number;
    bucket_0_7: number;
    bucket_8_30: number;
    bucket_31_90: number;
    bucket_91_180: number;
    bucket_180_plus: number;
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

export const BACKLOG_MILESTONE = "backlog";

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