# Learning and certification map

Stages describe evidence, not assumed personal mastery:

- BUILT: present in code.
- UNDERSTOOD: learner can independently explain the concept; not inferred from generated code.
- MANUALLY MODIFIED: this learning session records the learner's own edits.
- TESTED: relevant automated checks exist and passed.
- CERTIFIED: explicit exercise acceptance criteria passed, not universal mastery.
  Here “pending” means personal understanding has not been independently assessed.
  Test totals and latest execution evidence live in [current state](current-state.md).

| Concept                           | Built | Understood | Manually modified          | Tested | Certified / evidence                                       |
| --------------------------------- | ----- | ---------- | -------------------------- | ------ | ---------------------------------------------------------- |
| Express app/server separation     | Yes   | Pending    | Not established            | Yes    | Foundation tests; no separate learner certification        |
| Centralized errors                | Yes   | Pending    | Not established            | Yes    | Safe expected/unexpected HTTP responses                    |
| Graceful shutdown                 | Yes   | Pending    | Not established            | Yes    | Signals/draining and PostgreSQL pool ordering              |
| TypeScript interface / implements | Yes   | Pending    | Yes, status contract       | Yes    | Status collection contract acceptance only                 |
| Dependency injection              | Yes   | Pending    | Wiring correctly retained  | Yes    | Memory and PostgreSQL injection; no separate certification |
| Repository abstraction            | Yes   | Pending    | Yes, status adapters       | Yes    | Shared status collection acceptance                        |
| Runtime validation                | Yes   | Pending    | Yes, optional status query | Yes    | Status invalid-input acceptance                            |
| PostgreSQL pool                   | Yes   | Pending    | Not established            | Yes    | Startup, recovery and shutdown integration                 |
| Parameterized SQL                 | Yes   | Pending    | Yes, status query          | Yes    | Status result contract; prior injection-shaped-value test  |
| Migrations                        | Yes   | Pending    | Not established            | Yes    | Explicit migration/re-run verification in Phase 3          |
| Database constraints              | Yes   | Pending    | Not established            | Yes    | Direct-SQL integrity integration checks                    |
| Readiness                         | Yes   | Pending    | Not established            | Yes    | Availability/failure/recovery integration                  |
| findByStatus collection semantics | Yes   | Pending    | Yes                        | Yes    | CERTIFIED: multiple, one and zero matches in both adapters |
| Map key vs property filtering     | Yes   | Pending    | Yes                        | Yes    | CERTIFIED: memory status collection behavior               |
| Express collection-filter routing | Yes   | Pending    | Yes                        | Yes    | CERTIFIED: filter, invalid, absent query and ID regression |

Phase 4A additions (agent-implemented, not claimed as learner manual certification):

| Concept                         | Built | Understood | Manually modified | Tested     | Certified / evidence                              |
| ------------------------------- | ----- | ---------- | ----------------- | ---------- | ------------------------------------------------- |
| Category one-to-many relation   | Yes   | Pending    | No                | Yes        | Phase 4A relationship acceptance                  |
| Nullable foreign key / RESTRICT | Yes   | Pending    | No                | Yes        | Direct FK rejection and parent-delete protection  |
| Migration evolution             | Yes   | Pending    | No                | Yes        | Existing data preserved; migration 001 unchanged  |
| Multiple repository injection   | Yes   | Pending    | No                | Yes        | Shared Category lookup with memory and PostgreSQL |
| INNER JOIN / LEFT JOIN          | Yes   | Pending    | No                | Manual SQL | One versus two sample rows observed               |

See [Phase 4A evidence](phase-4a.md).

Manual-edit provenance comes from the status exercise and review in this project session.
Tests can certify behavior but cannot establish unaided understanding or recall.
Next coaching assessment can ask the learner to explain cardinality, Map keys,
query routing and adapter interchangeability without copying a solution.

Detailed explanations: [Phase 1](phase-1.md), [Phase 2](phase-2.md), [Phase 3](phase-3.md).
