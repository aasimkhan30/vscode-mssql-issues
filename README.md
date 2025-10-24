# vscode-mssql-issues
Workflow for extracting vscode issues as json.

## Development

This project is now written in TypeScript for better type safety and developer experience.

### Prerequisites
- Node.js
- GitHub CLI (`gh`) installed and authenticated

### Setup
```bash
npm install
```

### Building
```bash
npm run build
```

### Watch Mode
```bash
# Watch TypeScript files and rebuild on changes
npm run watch

# Watch and rebuild + run on changes (compiled JS)
npm run watch:dev <repo-name>

# Watch and run TypeScript directly on changes
npm run watch:ts <repo-name>
```

### Running
```bash
# Run the compiled JavaScript
npm start <repo-name>

# Build and run in one command
npm run dev <repo-name>

# Run TypeScript directly (development)
npm run dev:ts <repo-name>

# Bootstrap charts database (first time setup)
npm run bootstrap -- --inputPath <issues.json> --dbPath <database.db> --outputPath <charts.json>

# Incremental update (daily updates)
npm run incremental -- --inputPath <issues.json> --dbPath <database.db> --chartsPath <charts.json>
```

### Example
```bash
npm run dev microsoft/vscode-mssql
```

This will generate:
- `microsoft-vscode-mssql-all-issues.json` - Complete issue data
- `microsoft-vscode-mssql-issues.csv` - CSV export for analysis
