# BURN Token — Токеномика

> Дефляционный токен на блокчейне TON для экосистемы Burned Chats

## 📋 Содержание

- [Обзор токена](#обзор-токена)
- [Ключевые параметры](#ключевые-параметры)
- [Дефляционный механизм](#дефляционный-механизм)
- [Распределение эмиссии](#распределение-эмиссии)
- [Стейкинг](#стейкинг)
- [Utility (применение)](#utility-применение)
- [Anti-Whale механизмы](#anti-whale-механизмы)
- [Governance](#governance)
- [Техническая архитектура](#техническая-архитектура)
- [Smart Contracts](#smart-contracts)
- [Интеграция с BurnedChats](#интеграция-с-burnedchats)
- [План запуска](#план-запуска)
- [Риски и митигация](#риски-и-митигация)

---

## Обзор токена

### Философия

Название и механика токена **BURN** идеально совпадают с философией Burned Chats:

```
┌─────────────────────────────────────────────────────────────────┐
│                    🔥 BURN = PRIVACY + VALUE                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Сообщения сгорают    →    Токены сжигаются                    │
│   Приватность растёт   →    Дефицит увеличивается               │
│   Доверие укрепляется  →    Ценность повышается                 │
│                                                                  │
│   "Чем активнее использование — тем больше сжигается"           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Почему TON?

| Преимущество | Описание |
|--------------|----------|
| **Нативная интеграция** | TON встроен в Telegram через @wallet |
| **Мгновенные транзакции** | ~5 секунд на подтверждение |
| **Низкие комиссии** | ~$0.01-0.05 за транзакцию |
| **TON Connect** | Бесшовная авторизация в Mini App |
| **Jetton стандарт** | Проверенный стандарт токенов |
| **Экосистема** | DeDust, STON.fi, Tonkeeper |

---

## Ключевые параметры

```
┌─────────────────────────────────────────────────────────────────┐
│                      BURN TOKEN SPECS                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Название:           BURN                                       │
│   Блокчейн:           TON (The Open Network)                     │
│   Стандарт:           Jetton (TEP-74)                            │
│   Decimals:           9                                          │
│                                                                  │
│   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │
│                                                                  │
│   Максимальная эмиссия:    1,000 BURN                            │
│   Минимальная единица:     0.000000001 BURN (1 nano)             │
│                                                                  │
│   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │
│                                                                  │
│   Burn Rate:               1% от каждой транзакции               │
│   Staking Pool Rate:       0.5% от каждой транзакции             │
│   Treasury Rate:           0.2% от каждой транзакции             │
│                                                                  │
│   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │
│                                                                  │
│   Developer Allocation:    7 BURN (0.7%)                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Дефляционный механизм

### Базовый механизм (1% burn)

При каждой транзакции:

```
Отправитель: 100 BURN
    │
    ├── 0.5% → Сжигание навсегда 🔥     = 0.5 BURN
    ├── 0.3% → Staking Pool 💰          = 0.3 BURN  
    ├── 0.2% → Treasury 🏦              = 0.2 BURN
    │
    └── Получатель получает:            = 99.0 BURN
```

### Динамический Burn (опционально)

```
┌─────────────────────────────────────────┐
│         DYNAMIC BURN MECHANISM          │
├─────────────────────────────────────────┤
│                                         │
│  Базовый burn:              1.0%        │
│                                         │
│  Бонус за крупную          +0.5%        │
│  транзакцию (>10 BURN)                  │
│                                         │
│  Бонус за высокую          +0.25%       │
│  активность сети                        │
│  (>100 tx/час)                          │
│                                         │
│  ─────────────────────────────────      │
│  Максимальный burn:         1.75%       │
│                                         │
└─────────────────────────────────────────┘
```

### Прогноз дефляции

| Сценарий | Транзакций/день | Сожжено/год | Supply через год |
|----------|-----------------|-------------|------------------|
| Низкий | 100 | ~36 BURN | ~964 BURN |
| Средний | 500 | ~182 BURN | ~818 BURN |
| Высокий | 2000 | ~730 BURN | ~270 BURN |

> **Важно:** При высокой активности supply может сократиться на 70%+ за год!

### Точка невозврата

```
При достижении supply < 100 BURN:
├── Burn rate снижается до 0.1%
├── Staking rewards уменьшаются
└── Токен становится "коллекционным"
```

---

## Распределение эмиссии

### Allocation Chart

```
Total Supply: 1,000 BURN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  ████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  20%        │
│  Community Airdrop                           200 BURN            │
│                                                                  │
│  ██████████████████████████████░░░░░░░░░░░░░░░░░░░░  30%        │
│  Staking Rewards Pool                        300 BURN            │
│                                                                  │
│  ████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  20%        │
│  Ecosystem Development                       200 BURN            │
│                                                                  │
│  ████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  20%        │
│  Liquidity Pool (DEX)                        200 BURN            │
│                                                                  │
│  █████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  9.3%       │
│  Reserve                                      93 BURN            │
│                                                                  │
│  █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  0.7%       │
│  Developer                                     7 BURN            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Детали распределения

| Категория | Количество | % | Vesting | Назначение |
|-----------|------------|---|---------|------------|
| **Developer** | 7 | 0.7% | Без лока | Личная аллокация разработчика |
| **Community Airdrop** | 200 | 20% | — | Ранние пользователи BurnedChats |
| **Staking Rewards** | 300 | 30% | 5 лет | Награды за стейкинг |
| **Ecosystem** | 200 | 20% | 2 года | Гранты, партнёрства, маркетинг |
| **Liquidity** | 200 | 20% | — | DEX пулы (DeDust, STON.fi) |
| **Reserve** | 93 | 9.3% | 3 года | Непредвиденные расходы |

### Vesting Schedule

```
┌─────────────────────────────────────────────────────────────────┐
│                      VESTING TIMELINE                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Месяц    0    6    12   18   24   30   36   48   60            │
│          ─┬────┬────┬────┬────┬────┬────┬────┬────┬─            │
│           │    │    │    │    │    │    │    │    │             │
│  Airdrop  ████████████████████████████████████████  Сразу       │
│           │    │    │    │    │    │    │    │    │             │
│  Staking  ░░░░░████████████████████████████████████  Линейно    │
│           │    │    │    │    │    │    │    │    │  5 лет      │
│           │    │    │    │    │    │    │    │    │             │
│  Ecosystem░░░░░░░░░░████████████████████████░░░░░░░  Линейно    │
│           │    │    │    │    │    │    │    │    │  2 года     │
│           │    │    │    │    │    │    │    │    │             │
│  Reserve  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░████████  После     │
│           │    │    │    │    │    │    │    │    │  3 лет      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Стейкинг

### Tiered Staking System

```
┌─────────────────────────────────────────────────────────────────┐
│                      STAKING TIERS                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  🥉 FLEXIBLE (без лока)                                          │
│     ├── APY: 5%                                                  │
│     ├── Unstake: мгновенно                                       │
│     └── Бонусы: Базовый доступ к Premium                         │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  🥈 SILVER (6 месяцев)                                           │
│     ├── APY: 12%                                                 │
│     ├── Unstake: после периода                                   │
│     └── Бонусы: + Премиум темы оформления                        │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  🥇 GOLD (1 год)                                                 │
│     ├── APY: 20%                                                 │
│     ├── Unstake: после периода                                   │
│     └── Бонусы: + Групповые чаты (v2.0)                          │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  💎 DIAMOND (3 года)                                             │
│     ├── APY: 35%                                                 │
│     ├── Unstake: после периода                                   │
│     ├── Бонусы: + Governance права                               │
│     │           + Все Premium функции                            │
│     │           + Эксклюзивный NFT Badge                         │
│     └── Early Access: Бета-функции                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Источники Staking Rewards

```
Staking Pool пополняется из:

1. Initial Allocation:     300 BURN (30%)
2. Transaction Fees:       0.3% от каждой транзакции
3. Treasury Overflow:      Излишки из Treasury

Распределение наград:
├── 60% → Diamond стейкеры (3 года)
├── 25% → Gold стейкеры (1 год)
├── 10% → Silver стейкеры (6 мес)
└── 5%  → Flexible стейкеры
```

### Калькулятор доходности

| Стейк | Период | APY | Награда/год | Итого через период |
|-------|--------|-----|-------------|-------------------|
| 10 BURN | Flexible | 5% | 0.5 BURN | 10.5 BURN |
| 10 BURN | 6 мес | 12% | 0.6 BURN | 10.6 BURN |
| 10 BURN | 1 год | 20% | 2 BURN | 12 BURN |
| 10 BURN | 3 года | 35% | 10.5 BURN | 20.5 BURN |

> **Примечание:** APY может меняться в зависимости от общего объёма стейкинга

---

## Utility (применение)

### Use Cases в BurnedChats

```
┌─────────────────────────────────────────────────────────────────┐
│                    BURN TOKEN UTILITY                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. 🔓 PREMIUM FEATURES                                          │
│     ├── Групповые чаты (v2.0)  (NFT creation on BURN system)                                  │
│     ├── Увеличенные лимиты файлов (50 MB → 100 MB)               │
│     ├── Приоритетная доставка уведомлений                        │
│     ├── Кастомные темы оформления                                │
│     └── Расширенная история (до burn)                            │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  2. 🎁 REWARDS & INCENTIVES                                      │
│     ├── Airdrop ранним пользователям                             │
│     ├── Реферальная программа (invite friends)                   │
│     ├── Награда за баг-репорты                                   │
│     ├── Конкурсы и челленджи                                     │
│     └── Активность в сообществе                                  │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  3. 🗳️ GOVERNANCE                                                │
│     ├── Голосование за новые фичи                                │
│     ├── Приоритизация roadmap                                    │
│     ├── Изменение параметров (burn rate, staking APY)            │
│     └── Распределение Treasury                                   │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  4. 💎 STAKING BENEFITS                                          │
│     ├── Пассивный доход (APY до 35%)                             │
│     ├── Бесплатный Premium для стейкеров                         │
│     ├── Эксклюзивные NFT бейджи                                  │
│     └── Ранний доступ к бета-функциям                            │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  5. 🎨 COSMETICS & STATUS                                        │
│     ├── Уникальные аватар-рамки                                  │
│     ├── Анимированные эффекты burn                               │
│     ├── Эксклюзивные звуки уведомлений                           │
│     └── Статус "OG Holder" для ранних                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Premium Pricing (примерный)

| Функция | Стоимость | Альтернатива |
|---------|-----------|--------------|
| Групповой чат (создание) | 0.1 BURN | Gold/Diamond стейк |
| Увеличенный лимит файлов | 0.05 BURN/мес | Silver+ стейк |
| Кастомная тема | 0.02 BURN | Одноразово |
| Приоритетные уведомления | 0.01 BURN/мес | Gold+ стейк |

---

## Anti-Whale механизмы

### Лимиты

```typescript
// Защита от концентрации токенов

const ANTI_WHALE_LIMITS = {
  // Максимум на одном кошельке
  maxWalletPercent: 5,        // 50 BURN максимум
  maxWalletAmount: 50,
  
  // Максимум за одну транзакцию
  maxTxPercent: 1,            // 10 BURN максимум
  maxTxAmount: 10,
  
  // Cooldown между транзакциями
  cooldownSeconds: 60,        // 1 минута
  
  // Исключения
  excludedAddresses: [
    'STAKING_POOL',
    'LIQUIDITY_POOL', 
    'TREASURY'
  ]
};
```

### Механизм работы

```
┌─────────────────────────────────────────────────────────────────┐
│                    ANTI-WHALE PROTECTION                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Транзакция: Alice → Bob (15 BURN)                               │
│                                                                  │
│  Проверка 1: maxTxAmount                                         │
│  ├── 15 > 10 ❌                                                   │
│  └── REJECTED: "Max 10 BURN per transaction"                     │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  Транзакция: Alice → Bob (8 BURN)                                │
│  Bob текущий баланс: 45 BURN                                     │
│                                                                  │
│  Проверка 1: maxTxAmount                                         │
│  ├── 8 ≤ 10 ✅                                                    │
│                                                                  │
│  Проверка 2: maxWalletAmount                                     │
│  ├── 45 + 8 = 53 > 50 ❌                                          │
│  └── REJECTED: "Recipient would exceed 50 BURN limit"            │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  Транзакция: Alice → Bob (4 BURN)                                │
│  Bob текущий баланс: 45 BURN                                     │
│  Alice последняя tx: 30 сек назад                                │
│                                                                  │
│  Проверка 1: maxTxAmount ✅                                       │
│  Проверка 2: maxWalletAmount (45+4=49 ≤ 50) ✅                    │
│  Проверка 3: cooldown (30 < 60) ❌                                │
│  └── REJECTED: "Wait 30 more seconds"                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Governance

### Voting Power

```
Voting Power = Staked Amount × Time Multiplier

Time Multipliers:
├── Flexible:  1.0x
├── 6 months:  1.5x
├── 1 year:    2.0x
└── 3 years:   3.0x

Пример:
├── Alice: 10 BURN (3 года) → 10 × 3.0 = 30 VP
├── Bob:   20 BURN (flexible) → 20 × 1.0 = 20 VP
└── Alice имеет больше влияния несмотря на меньший стейк
```

### Governance Proposals

| Тип | Кворум | Порог принятия | Период голосования |
|-----|--------|----------------|-------------------|
| Parameter Change | 10% VP | 51% | 3 дня |
| Feature Priority | 5% VP | 51% | 7 дней |
| Treasury Spend | 20% VP | 66% | 7 дней |
| Emergency | 30% VP | 75% | 24 часа |

### Примеры proposals

```
┌─────────────────────────────────────────────────────────────────┐
│  PROPOSAL #001: Снизить burn rate до 0.5%                        │
├─────────────────────────────────────────────────────────────────┤
│  Type: Parameter Change                                          │
│  Proposer: 0x1234...                                             │
│  Required VP: 10%                                                │
│  Current VP: 15.3% ✅                                             │
│                                                                  │
│  Votes:                                                          │
│  ├── FOR:     62.4%  ████████████░░░░░░░░                        │
│  └── AGAINST: 37.6%  ███████░░░░░░░░░░░░░                        │
│                                                                  │
│  Status: PASSED ✅                                                │
│  Execution: In 48 hours                                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Техническая архитектура

### Общая схема

```
┌─────────────────────────────────────────────────────────────────┐
│                 BURNED CHATS + BURN TOKEN                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐         ┌─────────────┐        ┌─────────────┐ │
│  │  Frontend   │◄───────►│   Backend   │◄──────►│    Redis    │ │
│  │ (Mini App)  │   WSS   │ (Spring)    │        │             │ │
│  └──────┬──────┘         └──────┬──────┘        └─────────────┘ │
│         │                       │                                │
│         │ TON Connect           │ Verify balance                 │
│         ▼                       ▼                                │
│  ┌─────────────┐         ┌─────────────┐                        │
│  │  TON Wallet │◄───────►│  TON RPC    │                        │
│  │ (@wallet)   │         │  (toncenter)│                        │
│  └──────┬──────┘         └─────────────┘                        │
│         │                       ▲                                │
│         │                       │                                │
│         ▼                       │                                │
│  ┌─────────────────────────────┴───────────────────────────────┐│
│  │                      TON BLOCKCHAIN                          ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          ││
│  │  │ BURN Jetton │  │  Staking    │  │  Governance │          ││
│  │  │   Master    │  │   Pool      │  │   Contract  │          ││
│  │  └─────────────┘  └─────────────┘  └─────────────┘          ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Новые компоненты Frontend

```
frontend/src/
├── ton/
│   ├── connector.ts           # TON Connect интеграция
│   ├── burnToken.ts           # Взаимодействие с Jetton
│   ├── staking.ts             # Staking операции
│   ├── governance.ts          # Голосование
│   └── wallet.ts              # Баланс, история
├── components/
│   ├── Wallet/
│   │   ├── WalletButton.tsx   # Кнопка подключения
│   │   ├── Balance.tsx        # Отображение баланса
│   │   ├── SendModal.tsx      # Отправка токенов
│   │   └── History.tsx        # История транзакций
│   ├── Staking/
│   │   ├── StakingDashboard.tsx
│   │   ├── StakeModal.tsx
│   │   ├── UnstakeModal.tsx
│   │   └── RewardsCard.tsx
│   └── Governance/
│       ├── ProposalList.tsx
│       ├── ProposalDetail.tsx
│       ├── VoteModal.tsx
│       └── CreateProposal.tsx
├── hooks/
│   ├── useTonConnect.ts
│   ├── useBurnToken.ts
│   ├── useStaking.ts
│   └── useGovernance.ts
└── types/
    └── ton.ts
```

### Backend изменения

```
backend/src/main/java/dev/burnedchats/
├── ton/
│   ├── TonService.java            # TON RPC клиент
│   ├── JettonService.java         # Проверка баланса BURN
│   ├── StakingVerifier.java       # Проверка стейкинга
│   └── dto/
│       ├── WalletInfo.java
│       └── StakingInfo.java
├── premium/
│   ├── PremiumService.java        # Логика Premium доступа
│   ├── PremiumFeature.java        # Enum фич
│   └── PremiumController.java     # REST API
└── config/
    └── TonConfig.java             # Конфигурация TON
```

---

## Smart Contracts

### Структура контрактов

```
contracts/
├── jetton/
│   ├── burn-jetton-master.fc      # Главный контракт токена
│   ├── burn-jetton-wallet.fc      # Кошелёк пользователя
│   └── burn-logic.fc              # Логика дефляции
├── staking/
│   ├── staking-master.fc          # Главный контракт стейкинга
│   ├── staking-pool.fc            # Пул наград
│   └── lock-contract.fc           # Time-lock контракт
├── governance/
│   ├── governor.fc                # Главный контракт governance
│   ├── proposal.fc                # Контракт предложения
│   └── timelock.fc                # Задержка исполнения
├── scripts/
│   ├── deploy.ts                  # Деплой скрипты
│   ├── mint.ts                    # Минтинг
│   └── verify.ts                  # Верификация
└── tests/
    ├── jetton.spec.ts
    ├── staking.spec.ts
    └── governance.spec.ts
```

### Пример: BURN Jetton Master (Tact)

```tact
import "@stdlib/deploy";
import "@stdlib/ownable";

message Mint {
    amount: Int;
    receiver: Address;
}

message Burn {
    amount: Int;
}

contract BurnJettonMaster with Deployable, Ownable {
    totalSupply: Int;
    maxSupply: Int;
    burnRate: Int;           // В базисных пунктах (100 = 1%)
    stakingPoolRate: Int;    // В базисных пунктах
    treasuryRate: Int;       // В базисных пунктах
    
    owner: Address;
    stakingPool: Address;
    treasury: Address;
    
    init(owner: Address, stakingPool: Address, treasury: Address) {
        self.owner = owner;
        self.stakingPool = stakingPool;
        self.treasury = treasury;
        
        self.totalSupply = 0;
        self.maxSupply = 1000000000000;  // 1000 * 10^9 (9 decimals)
        
        self.burnRate = 50;              // 0.5%
        self.stakingPoolRate = 30;       // 0.3%
        self.treasuryRate = 20;          // 0.2%
    }
    
    receive(msg: Mint) {
        self.requireOwner();
        require(self.totalSupply + msg.amount <= self.maxSupply, "Max supply exceeded");
        
        self.totalSupply += msg.amount;
        self.mintTo(msg.receiver, msg.amount);
    }
    
    receive(msg: TokenTransfer) {
        let sender = context().sender;
        
        // Рассчитываем комиссии
        let burnAmount = msg.amount * self.burnRate / 10000;
        let stakingAmount = msg.amount * self.stakingPoolRate / 10000;
        let treasuryAmount = msg.amount * self.treasuryRate / 10000;
        let transferAmount = msg.amount - burnAmount - stakingAmount - treasuryAmount;
        
        // Сжигаем
        self.totalSupply -= burnAmount;
        emit(BurnEvent{amount: burnAmount, from: sender}.toCell());
        
        // В стейкинг пул
        self.transferTo(self.stakingPool, stakingAmount);
        
        // В treasury
        self.transferTo(self.treasury, treasuryAmount);
        
        // Получателю
        self.transferTo(msg.destination, transferAmount);
    }
    
    // Governance: изменение параметров
    receive(msg: UpdateBurnRate) {
        self.requireOwner();  // Позже заменить на governance
        require(msg.newRate >= 10 && msg.newRate <= 500, "Rate must be 0.1%-5%");
        self.burnRate = msg.newRate;
    }
    
    get fun totalSupply(): Int {
        return self.totalSupply;
    }
    
    get fun burnRate(): Int {
        return self.burnRate;
    }
}
```

### Пример: Staking Pool (Tact)

```tact
struct StakeInfo {
    amount: Int;
    lockPeriod: Int;      // 0, 180, 365, 1095 дней
    startTime: Int;
    lastClaim: Int;
}

contract StakingPool with Deployable, Ownable {
    stakes: map<Address, StakeInfo>;
    totalStaked: Int;
    rewardsPool: Int;
    
    // APY в базисных пунктах (500 = 5%, 3500 = 35%)
    apyFlexible: Int = 500;
    apySilver: Int = 1200;
    apyGold: Int = 2000;
    apyDiamond: Int = 3500;
    
    owner: Address;
    burnToken: Address;
    
    init(owner: Address, burnToken: Address) {
        self.owner = owner;
        self.burnToken = burnToken;
        self.totalStaked = 0;
        self.rewardsPool = 0;
    }
    
    receive(msg: Stake) {
        let sender = context().sender;
        let lockPeriod = msg.lockDays;
        
        require(lockPeriod == 0 || lockPeriod == 180 || 
                lockPeriod == 365 || lockPeriod == 1095, 
                "Invalid lock period");
        
        let existingStake = self.stakes.get(sender);
        if (existingStake != null) {
            // Claim existing rewards first
            self.claimRewards(sender);
        }
        
        self.stakes.set(sender, StakeInfo{
            amount: msg.amount + (existingStake?.amount ?? 0),
            lockPeriod: lockPeriod,
            startTime: now(),
            lastClaim: now()
        });
        
        self.totalStaked += msg.amount;
    }
    
    receive(msg: Unstake) {
        let sender = context().sender;
        let stake = self.stakes.get(sender);
        
        require(stake != null, "No stake found");
        
        let unlockTime = stake!!.startTime + (stake!!.lockPeriod * 86400);
        require(now() >= unlockTime, "Stake is still locked");
        
        // Claim rewards
        self.claimRewards(sender);
        
        // Return staked amount
        self.transferBurn(sender, stake!!.amount);
        
        self.totalStaked -= stake!!.amount;
        self.stakes.set(sender, null);
    }
    
    receive(msg: ClaimRewards) {
        self.claimRewards(context().sender);
    }
    
    fun claimRewards(staker: Address) {
        let stake = self.stakes.get(staker);
        require(stake != null, "No stake found");
        
        let apy = self.getAPY(stake!!.lockPeriod);
        let timeElapsed = now() - stake!!.lastClaim;
        let yearSeconds = 365 * 86400;
        
        let rewards = stake!!.amount * apy * timeElapsed / (10000 * yearSeconds);
        
        require(rewards <= self.rewardsPool, "Insufficient rewards pool");
        
        self.rewardsPool -= rewards;
        self.transferBurn(staker, rewards);
        
        // Update lastClaim
        let updatedStake = stake!!;
        updatedStake.lastClaim = now();
        self.stakes.set(staker, updatedStake);
    }
    
    fun getAPY(lockPeriod: Int): Int {
        if (lockPeriod == 0) { return self.apyFlexible; }
        if (lockPeriod == 180) { return self.apySilver; }
        if (lockPeriod == 365) { return self.apyGold; }
        if (lockPeriod == 1095) { return self.apyDiamond; }
        return 0;
    }
    
    get fun getStakeInfo(staker: Address): StakeInfo? {
        return self.stakes.get(staker);
    }
    
    get fun totalStaked(): Int {
        return self.totalStaked;
    }
    
    get fun rewardsPool(): Int {
        return self.rewardsPool;
    }
}
```

---

## Интеграция с BurnedChats

### Проверка Premium доступа

```java
// PremiumService.java
@Service
@RequiredArgsConstructor
public class PremiumService {
    
    private final TonService tonService;
    private final StakingVerifier stakingVerifier;
    
    public PremiumAccess checkAccess(String walletAddress) {
        // Проверяем баланс BURN
        BigDecimal balance = tonService.getBurnBalance(walletAddress);
        
        // Проверяем стейкинг
        StakingInfo staking = stakingVerifier.getStakingInfo(walletAddress);
        
        return PremiumAccess.builder()
            .hasGroupChats(staking.getTier() >= StakingTier.GOLD)
            .hasExtendedFileLimit(staking.getTier() >= StakingTier.SILVER)
            .hasPriorityNotifications(staking.getTier() >= StakingTier.GOLD)
            .hasCustomThemes(balance.compareTo(BigDecimal.ZERO) > 0)
            .hasGovernance(staking.getTier() == StakingTier.DIAMOND)
            .stakingTier(staking.getTier())
            .burnBalance(balance)
            .build();
    }
}
```

### Frontend: TON Connect

```typescript
// hooks/useTonConnect.ts
import { useTonConnectUI, useTonWallet } from '@tonconnect/ui-react';

export function useTonConnect() {
  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();
  
  const connect = async () => {
    await tonConnectUI.connectWallet();
  };
  
  const disconnect = async () => {
    await tonConnectUI.disconnect();
  };
  
  const sendBurn = async (to: string, amount: number) => {
    const transaction = {
      validUntil: Math.floor(Date.now() / 1000) + 60,
      messages: [
        {
          address: BURN_JETTON_MASTER,
          amount: toNano('0.05'), // Gas
          payload: buildTransferPayload(to, amount)
        }
      ]
    };
    
    return tonConnectUI.sendTransaction(transaction);
  };
  
  return {
    connected: !!wallet,
    address: wallet?.account.address,
    connect,
    disconnect,
    sendBurn
  };
}
```

### UI: Wallet Button

```tsx
// components/Wallet/WalletButton.tsx
import { useTonConnect } from '../../hooks/useTonConnect';
import { useBurnToken } from '../../hooks/useBurnToken';

export function WalletButton() {
  const { connected, address, connect, disconnect } = useTonConnect();
  const { balance, isLoading } = useBurnToken(address);
  
  if (!connected) {
    return (
      <button onClick={connect} className="wallet-button">
        🔗 Connect Wallet
      </button>
    );
  }
  
  return (
    <div className="wallet-info">
      <span className="balance">
        🔥 {isLoading ? '...' : balance} BURN
      </span>
      <button onClick={disconnect} className="disconnect-btn">
        {shortenAddress(address)}
      </button>
    </div>
  );
}
```

---

## План запуска

### Phase 1: Development (Недели 1-4)

```
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 1: SMART CONTRACT DEVELOPMENT                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Неделя 1-2: Jetton контракт                                     │
│  ├── [ ] Написать BURN Jetton Master                             │
│  ├── [ ] Написать BURN Jetton Wallet                             │
│  ├── [ ] Реализовать burn механику                               │
│  ├── [ ] Реализовать anti-whale лимиты                           │
│  └── [ ] Unit тесты (Sandbox)                                    │
│                                                                  │
│  Неделя 3-4: Staking контракт                                    │
│  ├── [ ] Написать Staking Pool                                   │
│  ├── [ ] Реализовать time-lock                                   │
│  ├── [ ] Реализовать rewards distribution                        │
│  ├── [ ] Unit тесты                                              │
│  └── [ ] Integration тесты                                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Phase 2: Testing (Недели 5-6)

```
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 2: TESTNET DEPLOYMENT & TESTING                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Неделя 5: Testnet                                               │
│  ├── [ ] Деплой на TON Testnet                                   │
│  ├── [ ] Тестирование burn при transfer                          │
│  ├── [ ] Тестирование staking flows                              │
│  ├── [ ] Тестирование anti-whale                                 │
│  └── [ ] Нагрузочное тестирование                                │
│                                                                  │
│  Неделя 6: Аудит                                                 │
│  ├── [ ] Внутренний security review                              │
│  ├── [ ] Формальная верификация (опционально)                    │
│  ├── [ ] Bug bounty (приватный)                                  │
│  └── [ ] Исправление найденных issues                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Phase 3: Integration (Недели 7-8)

```
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 3: BURNEDCHATS INTEGRATION                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Неделя 7: Frontend                                              │
│  ├── [ ] TON Connect интеграция                                  │
│  ├── [ ] Wallet UI компоненты                                    │
│  ├── [ ] Staking Dashboard                                       │
│  ├── [ ] Premium features unlock                                 │
│  └── [ ] Тестирование в Mini App                                 │
│                                                                  │
│  Неделя 8: Backend                                               │
│  ├── [ ] TON RPC интеграция                                      │
│  ├── [ ] Balance verification                                    │
│  ├── [ ] Staking verification                                    │
│  ├── [ ] Premium access logic                                    │
│  └── [ ] E2E тестирование                                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Phase 4: Launch (Недели 9-10)

```
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 4: MAINNET LAUNCH                                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Неделя 9: Mainnet Deploy                                        │
│  ├── [ ] Деплой контрактов на Mainnet                            │
│  ├── [ ] Минтинг initial supply                                  │
│  ├── [ ] Настройка Liquidity Pool (DeDust/STON.fi)               │
│  ├── [ ] Верификация контрактов                                  │
│  └── [ ] Финальное тестирование                                  │
│                                                                  │
│  Неделя 10: Community Launch                                     │
│  ├── [ ] Airdrop ранним пользователям                            │
│  ├── [ ] Анонс в Telegram каналах                                │
│  ├── [ ] Листинг на DEX                                          │
│  ├── [ ] Запуск staking                                          │
│  └── [ ] Мониторинг и поддержка                                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Риски и митигация

| Риск | Вероятность | Влияние | Митигация |
|------|-------------|---------|-----------|
| **Smart contract bug** | Средняя | Критическое | Аудит, тесты, bug bounty |
| **Low liquidity** | Высокая | Высокое | Достаточный LP allocation (20%) |
| **Whale manipulation** | Средняя | Высокое | Anti-whale механизмы |
| **Regulatory issues** | Низкая | Критическое | Utility token, не security |
| **Low adoption** | Средняя | Высокое | Привязка к реальной utility |
| **TON network issues** | Низкая | Высокое | Мониторинг, fallback планы |
| **Staking pool drain** | Низкая | Высокое | Лимиты на rewards, vesting |

### Contingency Plans

```
┌─────────────────────────────────────────────────────────────────┐
│  EMERGENCY PROCEDURES                                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Critical Bug Found:                                          │
│     ├── Pause контракт (если возможно)                           │
│     ├── Уведомить сообщество                                     │
│     ├── Разработать и протестировать fix                         │
│     └── Деплой обновлённого контракта                            │
│                                                                  │
│  2. Liquidity Crisis:                                            │
│     ├── Использовать Reserve allocation                          │
│     ├── Временно снизить staking rewards                         │
│     └── Партнёрства для дополнительной ликвидности               │
│                                                                  │
│  3. Whale Attack:                                                │
│     ├── Активировать emergency governance                        │
│     ├── Временно увеличить cooldown                              │
│     └── Снизить max tx/wallet лимиты                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Метрики успеха

### Launch Metrics (первый месяц)

| Метрика | Цель |
|---------|------|
| Unique holders | > 500 |
| Total staked | > 30% supply |
| Daily transactions | > 100 |
| Liquidity (DEX) | > $10,000 |
| Premium users | > 50 |

### Growth Metrics (6 месяцев)

| Метрика | Цель |
|---------|------|
| Unique holders | > 5,000 |
| Total staked | > 50% supply |
| Tokens burned | > 10% initial supply |
| Daily active users | > 500 |
| Governance participation | > 20% of stakers |

---

## Связанные документы

- [ROADMAP.md](./ROADMAP.md) — общий roadmap с токеном
- [ARCHITECTURE.md](./ARCHITECTURE.md) — техническая архитектура
- [SECURITY.md](./SECURITY.md) — безопасность системы
- [API.md](./API.md) — API спецификация

---

## FAQ

### Почему только 1,000 токенов?

Низкая эмиссия создаёт:
- Психологическую ценность ("владею целым токеном")
- Естественный дефицит
- Простоту понимания (1 BURN = значимая сумма)

### Почему 0.7% developer allocation?

- Демонстрирует веру в проект
- Минимизирует риск "rug pull"
- Выравнивает интересы с сообществом

### Что если supply станет слишком маленьким?

При supply < 100 BURN:
- Burn rate автоматически снижается до 0.1%
- Staking rewards уменьшаются пропорционально
- Токен становится "коллекционным активом"

### Можно ли изменить параметры?

Да, через governance:
- Burn rate (0.1% - 5%)
- Staking APY
- Anti-whale лимиты
- Treasury распределение

Требуется голосование Diamond стейкеров.
