---
sidebar_position: 1
title: "Browsing & Filtering"
description: "Navigate the ProjectAchilles test browser — grid/list views, search, filters, favorites, and categories."
---

# Browsing & Filtering

The Test Browser is the primary interface for discovering and managing security tests.

## Overview Dashboard

The browser page opens with a 3-tab layout:

1. **Overview** — Category legend and summary statistics
2. **Matrix** — MITRE ATT&CK coverage heatmap
3. **List** — Filterable test grid/list

## Views

Toggle between **Grid** and **List** views using the view selector in the top-right corner.

- **Grid view** — Card-based layout showing test name, category, severity, and platform badges
- **List view** — Compact table with sortable columns

## Filtering

The filter bar supports multiple simultaneous filters:

| Filter | Description |
|--------|-------------|
| **Search** | Free-text search across test names and descriptions |
| **Category** | Filter by test category (e.g., defense-evasion, persistence) |
| **Technique** | Filter by MITRE ATT&CK technique ID (e.g., T1059) |
| **Platform** | Filter by target platform (Windows, Linux, macOS) |
| **Severity** | Filter by severity level (Critical, High, Medium, Low) |

Filters are additive — combining multiple filters narrows the results.

## Favorites

Click the star icon on any test card to favorite it. Favorites are stored per-user in the browser's local storage. Use the **Favorites** filter to show only starred tests.

## Categories

Tests are organized into categories that map to MITRE ATT&CK tactics:
- Defense Evasion
- Persistence
- Privilege Escalation
- Credential Access
- Lateral Movement
- Discovery
- Collection
- Exfiltration
- And more...

Each category has a color-coded badge in the test cards.
