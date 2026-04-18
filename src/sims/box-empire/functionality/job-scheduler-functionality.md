# Job Scheduler Functionality

The job scheduler is the business process that turns container needs into work for equipment.

## Job Purpose

A job represents a planned container move from one place to another. Jobs are created when the sim needs a container moved for the current operation.

Examples include:

- Store an export container from a truck into the yard.
- Move an import container from the quay into the yard.
- Load an import container from the yard onto a pickup truck.
- Stage an export container from the yard to the quay.
- Load an export container from the quay onto the vessel.
- Shuffle a top container to unblock another container.

## Job Status

A job can be:

- Pending: waiting for suitable equipment.
- Assigned: equipment has accepted the job.
- In progress: the move is underway.
- Blocked: the job cannot currently happen, usually because a yard container is buried.
- Completed: the move finished.
- Cancelled: the job was stopped before completion.

## Priority

Jobs are assigned by priority first. If priorities are equal, older jobs are handled before newer jobs.

## Equipment Matching

Jobs are assigned only to equipment that can perform that type of work.

The reach stacker handles yard, truck, and quay buffer moves.

The mobile harbor crane handles vessel and quay buffer moves.

Equipment must be on, idle, and allowed to serve the job's area or direction.

## Blocked Jobs

If a job needs to pick up a container from the yard but that container is not on top of its stack, the job is blocked.

Blocked jobs are checked again later. Once the container becomes accessible, the job can return to pending and be assigned.

## Reassignment

When a player manually sends a container to a new destination, any existing active job for that container is cancelled before the new job is created.

