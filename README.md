# Git Analysis Tool

A full-stack JavaScript tool for visualizing technical debt via file churn, co-change coupling, and LLM-powered structural insights.

## Quick Start

```bash
npm install
npm run dev
```

This starts both the backend (Express, port 3001) and frontend (Vite, port 5173).

## Architecture

- **Backend:** Node.js + Express, `simple-git` for git operations, SQLite for caching
- **Frontend:** React + Vite, D3.js for visualizations, TailwindCSS for styling

## Usage

1. Start the app with `npm run dev`
2. Open `http://localhost:5173`
3. Enter the path to a local git repository
4. Explore churn hotspots, co-change coupling, and more
