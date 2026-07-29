# Game Session State Machine Specification

## Purpose

The Game Session State Machine defines the complete lifecycle of every Bingo game session. It ensures that all gameplay follows a predictable sequence, prevents invalid operations, enables crash recovery, supports player reconnection, and provides a single source of truth for the current state of a game.

Every game session must exist in exactly one state at any given time, and transitions between states must be controlled exclusively by the backend.

## Objectives

The state machine must:
- Provide one authoritative lifecycle for every game.
- Prevent invalid state transitions.
- Support multiplayer synchronization.
- Allow players to reconnect without losing progress.
- Enable session recovery after server failures.
- Support auditing and replay of completed games.
- Ensure payouts occur only after successful winner validation.
- Simplify monitoring and administration.

## Game Session Lifecycle Overview

```
CREATED -> WAITING_FOR_PLAYERS -> COUNTDOWN -> LOCKED -> DRAWING -> WINNER_PENDING -> PAYOUT -> FINISHED -> ARCHIVED
```

## State Descriptions

### 1. CREATED
- **Purpose:** A new game session has been created but is not yet visible/joinable until configured.
- **Actions:** Generate Session ID (`gameId`), create DB record in `games`, initialize game config, set RNG seed.
- **DB:** `games.status = 'CREATED'`
- **Exit:** Move to `WAITING_FOR_PLAYERS`.

### 2. WAITING_FOR_PLAYERS
- **Purpose:** Players join the lobby before the game countdown starts.
- **Actions:** Accept join requests, wallet verification, ticket generation. Track player count.
- **Exit:** When min players reached (e.g. 2 players), move to `COUNTDOWN`.

### 3. COUNTDOWN
- **Purpose:** Short timer before locking the lobby.
- **Actions:** Broadcast countdown tick every second. Players can still join until countdown ends.
- **Exit:** Timer reaches zero -> Move to `LOCKED`.

### 4. LOCKED
- **Purpose:** Freeze lobby state.
- **Actions:** Disable new joins, leaves, ticket modifications. Generate final player list & ticket mapping. Freeze wallet balances.
- **Exit:** Initialize game engine -> Move to `DRAWING`.

### 5. DRAWING
- **Purpose:** Execute the Bingo draw.
- **Actions:** Draw numbers at set intervals, broadcast every draw, auto-mark numbers.
- **Exit:** Winning condition met -> Move to `WINNER_PENDING`. (If no numbers left -> draw refund & FINISHED).

### 6. WINNER_PENDING
- **Purpose:** Validate winning claim before awarding prizes.
- **Actions:** Verify ticket ownership, draw history, winning pattern, duplicate claims.
- **Exit:** Winner confirmed -> Move to `PAYOUT`.

### 7. PAYOUT
- **Purpose:** Process financial transactions atomically.
- **Actions:** Begin DB transaction (`BEGIN...COMMIT`), calculate prize & admin fee, credit wallets, log transactions.
- **Exit:** Transaction committed -> Move to `FINISHED`.

### 8. FINISHED
- **Purpose:** Game completed successfully.
- **Actions:** Broadcast final results, display winner & prize, unlock interface.
- **Exit:** Move to `ARCHIVED`.

### 9. ARCHIVED
- **Purpose:** Store game permanently for auditing and history.
