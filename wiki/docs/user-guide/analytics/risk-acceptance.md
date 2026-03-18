---
sidebar_position: 5
title: "Risk Acceptance"
description: "Accept risk for individual security controls with audit tracking in ProjectAchilles."
---

# Risk Acceptance

## Overview

Risk Acceptance allows you to formally acknowledge that certain security controls are not detected — and that this is an accepted risk rather than a gap to fix.

## Accepting Risk

1. In the Execution Table or Defense Score breakdown, find the unprotected control
2. Click the **Accept Risk** button on the row
3. Provide a justification (required)
4. The control is marked as "Risk Accepted" and excluded from the Defense Score calculation

## Audit Trail

All risk acceptance decisions are tracked with:
- **Who** accepted the risk (Clerk user ID)
- **When** the decision was made
- **Why** (the justification provided)

## Revoking Acceptance

Risk acceptance can be revoked at any time, which returns the control to the "Unprotected" category and recalculates the Defense Score.
