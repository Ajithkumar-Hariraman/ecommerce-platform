# Module boundaries before microservices

## Context

The application currently has one Product domain and one backend process.
The learning goal is clear responsibility and dependency flow before distributed
communication and operational complexity.

## Decision

Keep a modular monolith: routes, validation, controllers, services and repository
adapters have clear boundaries inside the same API. Use explicit dependency
injection. Do not split into microservices without an actual requirement.

## Consequences

Local development, debugging and changes remain straightforward. Module boundaries
can evolve independently of process boundaries. Shared deployment and process
resources remain intentional; isolation across distributed services is not provided.
