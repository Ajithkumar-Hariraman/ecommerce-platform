# PostgreSQL and raw pg/SQL before an ORM

## Context
This production-learning backend needs durable Product persistence and practical
experience with SQL, pooling, constraints, migrations and query plans.
The existing repository interface already separates business rules from storage.

## Decision
Use PostgreSQL through node-postgres (pg) with parameterized SQL, explicit row
mapping and versioned SQL migrations. Do not introduce an ORM at this stage.
This records the existing Phase 3 choice; implementation details are in
[the Phase 3 report](../phase-3.md).

## Consequences
SQL and database behavior stay visible for learning and review. The adapter owns
queries/mapping/error translation; the service keeps its repository dependency.
Developers maintain SQL and migrations directly. Future ORM adoption requires
a concrete need and an explicit decision, not an automatic next step.
