# ProjectAchilles Gemini Discovery

## Project Overview

This is a comprehensive security testing platform named ProjectAchilles. It features a modern web interface built with **React 19** and a robust backend powered by **Express.js**. The platform is designed for security professionals to browse, execute, and analyze security tests.

### Core Technologies:

-   **Frontend**: React 19, TypeScript, Vite, Tailwind CSS, Redux Toolkit
-   **Backend**: Express.js, TypeScript, Node.js
-   **Authentication**: Clerk for user authentication (JWT-based).
-   **Databases/Integrations**:
    -   Elasticsearch for analytics.
    -   LimaCharlie for endpoint management.
-   **Testing**: The `tests_source` directory contains a repository of security tests, each with detailed documentation, metadata, and associated files (e.g., Go binaries, KQL queries, YARA rules).

### Architecture:

The project is a monorepo with three main parts:

1.  `frontend/`: A React single-page application that provides the user interface for the platform.
2.  `backend/`: An Express.js server that provides the API for the frontend.
3.  `tests_source/`: A collection of security tests, each in its own directory, with detailed documentation and associated artifacts.

## Building and Running

### Prerequisites

-   Node.js 18.x or higher
-   npm 9.x or higher
-   Git

### Quick Start (Full Stack)

To run the entire stack (frontend and backend), use the provided shell script. This will also install all dependencies.

```bash
./start.sh
```

-   **Frontend**: `http://localhost:5173`
-   **Backend**: `http://localhost:3000`

### Individual Services

You can also run the frontend and backend services separately.

**Frontend:**

```bash
cd frontend
npm install
npm run dev
```

**Backend:**

```bash
cd backend
npm install
npm run dev
```

### Building for Production

**Frontend:**

```bash
cd frontend
npm run build
```

**Backend:**

```bash
cd backend
npm run build
```

## Development Conventions

### Authentication

-   Authentication is handled by **Clerk**. You will need to create a Clerk account and set up an application to get the required API keys.
-   The frontend requires `VITE_CLERK_PUBLISHABLE_KEY` in `frontend/.env`.
-   The backend requires `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` in `backend/.env`.

### API

-   All API endpoints are prefixed with `/api`.
-   Most endpoints require authentication. The JWT token should be included in the `Authorization: Bearer <token>` header.
-   The API is structured into modules: `browser`, `analytics`, and `endpoints`.

### State Management

-   The frontend uses **Redux Toolkit** for state management.
-   The Redux store is organized into slices, which can be found in `frontend/src/store`.

### Security Tests

-   The security tests are located in the `tests_source` directory.
-   Each test has its own directory, identified by a UUID.
-   Each test directory contains:
    -   A `README.md` with an overview of the test.
    -   A `*_info.md` file with detailed metadata about the test.
    -   The test source code (e.g., a Go binary).
    -   Detection rules (e.g., KQL, YARA).
    -   Attack flow diagrams.
