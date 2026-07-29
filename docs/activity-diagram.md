# Bingo System Activity Diagram

This document captures the main activity flow for the Telegram Bingo mini-app, including bot launch, WebApp gameplay, lobby progression, draw resolution, and wallet-related actions.

## 1) End-to-end gameplay activity

```mermaid
flowchart TD
    A([Start]) --> B[User opens Telegram bot]
    B --> C[Bot shows Play Bingo button]
    C --> D[User taps Play Bingo]
    D --> E[Bot sends WebApp URL with optional stake]
    E --> F[User opens WebApp]
    F --> G[WebApp loads and fetches wallet balance]
    G --> H{Enough balance for stake?}

    H -- No --> H1[Show insufficient balance warning]
    H1 --> A

    H -- Yes --> I[User selects stake and 15 numbers]
    I --> J{Selection valid?}
    J -- No --> J1[Show validation error]
    J1 --> I

    J -- Yes --> K[User clicks Join]
    K --> L[WebApp sends join action over WebSocket]
    L --> M[Server verifies Telegram initData]
    M --> N{Authenticated?}

    N -- No --> N1[Reject join with auth error]
    N1 --> A

    N -- Yes --> O[Server validates numbers and stake]
    O --> P{Balance sufficient?}
    P -- No --> P1[Reject join with balance error]
    P1 --> A

    P -- Yes --> Q[Deduct stake and record join]
    Q --> R[Create or reuse lobby session]
    R --> S[Broadcast lobby update to players]
    S --> T{Player count >= 2 and countdown not active?}

    T -- Yes --> U[Start countdown timer]
    T -- No --> V[Wait for more players]

    U --> W[Countdown tick]
    W --> X{Countdown finished?}
    X -- No --> W
    X -- Yes --> Y[Start game and shuffle available numbers]

    Y --> Z[Draw numbers every 2 seconds]
    Z --> AA{Winner found?}

    AA -- No --> AB{Any numbers left?}
    AB -- Yes --> Z
    AB -- No --> AC[End game as draw]

    AA -- Yes --> AD[Resolve winner and calculate payout]
    AD --> AE[Credit winner and record transactions]
    AE --> AF[Broadcast game result to all players]

    AC --> AF
    AF --> AG[Players see game-over state and wallet updates]
    AG --> A
```

## 2) Wallet and profile activity

```mermaid
flowchart TD
    A([User action]) --> B{Action type}
    B -- View balance/profile --> C[WebApp calls /api/user-balance or /api/user-profile]
    B -- View history --> D[WebApp calls /api/user-history]
    B -- View transactions --> E[WebApp calls /api/user-transactions]
    B -- Request withdrawal --> F[WebApp calls /api/request-withdrawal]
    B -- Request deposit --> G[WebApp calls /api/request-deposit]

    C --> H[Server verifies Telegram initData]
    D --> H
    E --> H
    F --> H
    G --> H

    H --> I{Valid authentication?}
    I -- No --> J[Return 401 Unauthorized]
    I -- Yes --> K[Fetch or update wallet data]

    K --> L{Action}
    L -- Balance/profile/history/transactions --> M[Return data to WebApp]
    L -- Withdrawal --> N[Validate amount and phone, lock funds, create request]
    L -- Deposit --> O[Create pending deposit request and notify admin]

    N --> P[Return success or validation error]
    O --> P
    M --> Q([Done])
    P --> Q
```

## 3) Key components involved

- Telegram Bot: launches the WebApp and starts the game flow
- WebApp frontend: handles selection, join, and live game UI
- WebSocket server: manages lobby join, countdown, and live number draw events
- API server: exposes authenticated wallet and profile endpoints
- PostgreSQL: stores balances, game history, transactions, deposits, and withdrawals
