// Token Radar model v2 ("radar-2"): one sealed snapshot in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) plus every
// other rankable pre-token protocol below the floor: the early rows the radar exists to find.
// A protocol is pre-token when its record carries no token (mcap_usd, gecko_id and symbol all null);
// protocols whose token already trades are kept apart in the Live view with their market caps.
//
// Implied value follows only from the snapshot's own figures -- never from a protocol's name:
//
//   size       = 12 * tvl_usd^0.8            (power-law size: log-scale compression, not linear TVL)
//   growth     = clamp(change_7d, -50, +100)  (7-day TVL momentum, extreme prints clamped)
//   growthMult = 1 + growth/100 * 0.6        (0.70 .. 1.60)
//   maturity   = 0.75 + 0.35 * (1 - exp(-age_days/540))
//                age = days since listed_at; unknown age counts as 365 days (0.75 .. 1.10)
//   category   = clamp(sqrt(catMedianTvl / allMedianTvl), 0.85, 1.18)
//                medians over pre-token protocols only; a category whose pre-token protocols
//                typically hold more TVL earns a premium, capped so no category dominates
//   breadth    = 1 + 0.02 * min(chains, 8)    (1.02 .. 1.16; multi-chain reach)
//   implied    = round(size * growthMult * maturity * category * breadth)
//
// Every multiplier is bounded, so the ranking is driven by size first and then genuinely re-ordered
// by momentum, maturity, category strength and breadth -- a fast-growing young protocol can outrank
// a larger stagnant one. No protocol name is ever special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the page recomputes them. */
export interface ModelConstants {
  size_scale: number;
  size_power: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_halflife_days: number;
  unknown_age_days: number;
  category_floor: number;
  category_cap: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  size_scale: 12,
  size_power: 0.8,
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.75,
  maturity_range: 0.35,
  maturity_halflife_days: 540,
  unknown_age_days: 365,
  category_floor: 0.85,
  category_cap: 1.18,
  breadth_per_chain: 0.02,
  breadth_max_chains: 8,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    size_base_usd: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    category_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  category_multiplier: number;
  breadth_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  category_median: Record<string, number>;
  overall_median: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Median of a sorted-ascending copy; 0 when empty. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

/** Category medians over pre-token protocols, keyed by category (null -> "Other"). */
export function categoryMedians(protocols: SnapshotProtocol[]): { byCategory: Record<string, number>; overall: number } {
  const pre = protocols.filter(isPreToken);
  const overall = median(pre.map((p) => p.tvl_usd));
  const groups = new Map<string, number[]>();
  for (const p of pre) {
    const key = p.category ?? 'Other';
    const list = groups.get(key) ?? [];
    list.push(p.tvl_usd);
    groups.set(key, list);
  }
  const byCategory: Record<string, number> = {};
  for (const [key, list] of [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    byCategory[key] = median(list);
  }
  return { byCategory, overall };
}

/** The category multiplier: how this protocol's category compares with the pre-token median. */
export function categoryMultiplier(category: string | null, byCategory: Record<string, number>, overall: number, model: ModelConstants): number {
  if (overall <= 0) return 1;
  const catMedian = byCategory[category ?? 'Other'] ?? overall;
  const raw = Math.sqrt(catMedian / overall);
  return Math.min(model.category_cap, Math.max(model.category_floor, raw));
}

/** The five multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  byCategory: Record<string, number>,
  overall: number,
): { implied: number; sizeBase: number; growthPct: number; growthMult: number; maturityMult: number; catMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + model.maturity_range * (1 - Math.exp(-Math.max(ageForModel, 0) / model.maturity_halflife_days));
  const catMult = categoryMultiplier(protocol.category, byCategory, overall, model);
  const breadthMult = 1 + model.breadth_per_chain * Math.min(protocol.chains.length, model.breadth_max_chains);
  const sizeBase = model.size_scale * Math.pow(Math.max(protocol.tvl_usd, 1), model.size_power);
  const implied = Math.max(1, Math.round(sizeBase * growthMult * maturityMult * catMult * breadthMult));
  return { implied, sizeBase: Math.round(sizeBase), growthPct, growthMult, maturityMult, catMult, breadthMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const { byCategory, overall } = categoryMedians(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol below the watchlist floor, not just the
  // biggest few -- the radar exists to find these. A chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const watch = new Set(snapshot.watchlist);
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model, byCategory, overall);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    watchlist: watch.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      size_base_usd: s.sizeBase,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      category_multiplier: round4(s.catMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 120;
  if (p.tvl_usd >= 25_000_000) return 75;
  return 50;
}

/** Gas for one transaction on the protocol's main chain: Ethereum is dear, the rest are cheap. */
function gasFor(p: SnapshotProtocol): number {
  return chainOf(p) === 'Ethereum' ? 8 : 2;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 75;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The category group a protocol farms as: derived from its category string only. */
export function farmGroup(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'lending';
  if (c.includes('dex') || c.includes('liquidity manager')) return 'dex';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('stak') || c.includes('restak')) return 'staking';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options') || c.includes('basis')) return 'derivatives';
  if (c.includes('rwa') || c.includes('anchor btc') || c.includes('decentralized btc')) return 'rwa';
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return 'curator';
  if (c.includes('stable')) return 'stable';
  if (c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) return 'yield';
  if (c.includes('prediction')) return 'prediction';
  if (c.includes('insurance')) return 'insurance';
  if (c.includes('payment') || c.includes('card')) return 'payments';
  return 'other';
}

interface GroupPlan {
  core1: string;
  core2: string;
  risk: string;
  eligibility: string;
}

/** The category-specific core of a farm plan: two actions, a risk, and an eligibility nuance. */
function groupPlan(group: string, p: SnapshotProtocol, capital: number, chain: string): GroupPlan {
  const n = p.name;
  switch (group) {
    case 'lending':
      return {
        core1: `Supply $${capital} of USDC to ${n} on ${chain} as collateral, then borrow back $20 of USDC against it so both sides of the book are active`,
        core2: `Repay half the borrow after a week and re-supply the freed collateral, so the position shows two separate qualifying actions`,
        risk: `Liquidation is the risk here: keep the loan-to-value under 50% and never borrow the maximum, or a price dip can close the position`,
        eligibility: `Lending points usually count supplied time, not just size, so a smaller position held for weeks can outrank a large one held for a day`,
      };
    case 'dex':
      return {
        core1: `Provide $${capital} of liquidity to ${n}'s deepest pool on ${chain}, in a balanced pair, and keep the position in range`,
        core2: `Swap $10 through ${n} on ${chain} once a week, alternating the direction, so trading volume is recorded as well as liquidity`,
        risk: `Impermanent loss is the risk here: a narrow range earns more fees but can go out of range and stop earning, so check the range weekly`,
        eligibility: `DEX rewards usually count both liquidity time and swap volume, so the weekly swap matters as much as the deposit itself`,
      };
    case 'bridge':
      return {
        core1: `Bridge $${capital} of USDC into ${chain} through ${n}, then use the bridged funds inside an app on that chain instead of bridging straight back`,
        core2: `A week later bridge $25 back through ${n} on a different route or to a second chain, so the history shows repeat use, not one round trip`,
        risk: `Bridging risk is the risk here: a bridge moves funds across chains, so start with the smallest amount the route accepts and verify the receipt before sending more`,
        eligibility: `Bridge programs usually count volume and repeat crossings, and a same-day round trip is often filtered out as wash volume`,
      };
    case 'staking':
      return {
        core1: `Stake $${capital} of the chain's staking asset through ${n} on ${chain} and hold the liquid receipt token it issues`,
        core2: `Use $25 of the receipt token in a lending or liquidity pool on ${chain}, so the position is staked and deployed at the same time`,
        risk: `Slashing and depeg are the risks here: the receipt token can trade below the staked asset, so watch its peg before adding more`,
        eligibility: `Staking programs usually count the staked balance over time, so unstaking early can reset the clock even if the amount was large`,
      };
    case 'derivatives':
      return {
        core1: `Deposit $${capital} of USDC as margin on ${n} on ${chain} and open one small hedged position, sized under 10% of the margin`,
        core2: `Close the hedge after a few days and open a fresh one in the opposite direction, so the account shows two settled trades`,
        risk: `Liquidation is the risk here: keep leverage under 2x and the position small, or a fast move can wipe the margin`,
        eligibility: `Perp programs usually count trading volume and open interest over time, so one large trade counts less than steady small ones`,
      };
    case 'rwa':
      return {
        core1: `Mint $${capital} of ${n}'s yield-bearing asset on ${chain} and hold it in the farming wallet for the full hold period`,
        core2: `After two weeks, add $25 more of the same asset so the position shows a second purchase at a later date`,
        risk: `Issuer and custody risk are the risks here: a real-world asset depends on its issuer and custodian, so read who holds the underlying before minting`,
        eligibility: `RWA programs usually count holding time and the number of mints, so a second purchase after two weeks helps more than one large mint`,
      };
    case 'curator':
      return {
        core1: `Deposit $${capital} into a ${n} vault on ${chain} and hold the vault shares for the full hold period`,
        core2: `After two weeks move $25 of the shares into a second vault of ${n} on the same chain, so the account shows two vaults`,
        risk: `Vault-strategy risk is the risk here: a curator's vault can change strategy, so check the vault's current allocation before depositing`,
        eligibility: `Curator programs usually count vault shares held over time across vaults, so splitting across two vaults can count better than one`,
      };
    case 'stable':
      return {
        core1: `Mint $${capital} of the stable asset through ${n} on ${chain} and hold it in the farming wallet`,
        core2: `Use $25 of the minted stablecoin in a lending pool on ${chain}, so the position is minted and in use at the same time`,
        risk: `Depeg is the risk here: a stable asset can trade below its peg, so check its price and backing before minting a large amount`,
        eligibility: `Stablecoin programs usually count minted supply held over time, so holding through a full month counts more than a same-day mint and burn`,
      };
    case 'yield':
      return {
        core1: `Deposit $${capital} into ${n}'s highest-yield vault on ${chain} and leave the position compounding`,
        core2: `After a week, claim the accrued yield and re-deposit it into the same vault, so the account shows a harvest and a re-deposit`,
        risk: `Strategy risk is the risk here: a yield vault's strategy can change or pause, so check the vault's current APY and strategy before depositing`,
        eligibility: `Yield programs usually count deposits held over time plus harvests, so the weekly claim-and-redeposit helps more than a single deposit`,
      };
    case 'prediction':
      return {
        core1: `Fund $${capital} on ${n} and place one $10 position on a market that resolves after the hold period`,
        core2: `Place a second $10 position on a different market the following week, so the account shows two markets, not one bet`,
        risk: `Total loss on a wrong outcome is the risk here: keep each position small and never stake the whole balance on one market`,
        eligibility: `Prediction programs usually count the number of markets traded and volume, so two small positions beat one large one`,
      };
    case 'insurance':
      return {
        core1: `Buy $${capital} of cover from ${n} on ${chain} for a protocol you already use, and keep the policy active`,
        core2: `After two weeks, extend the same policy by $25 or buy cover for a second protocol, so the account shows repeat cover`,
        risk: `Claim-denial risk is the risk here: cover pays only for the events its policy names, so read the covered events before buying`,
        eligibility: `Insurance programs usually count active cover over time, so a policy held for weeks counts more than a same-day buy and cancel`,
      };
    case 'payments':
      return {
        core1: `Move $${capital} into ${n} on ${chain} and make one real payment or top-up through it, then keep a balance for the hold period`,
        core2: `Make a second small payment the following week, so the account shows repeat use rather than a single top-up`,
        risk: `Counterparty risk is the risk here: funds sit with the provider, so keep only the farming amount in the account`,
        eligibility: `Payments programs usually count transaction count and volume, so two small payments beat one large top-up`,
      };
    default:
      return {
        core1: `Deposit $${capital} of USDC into ${n} on ${chain} and keep the position open for the full hold period`,
        core2: `After a week, add $25 more to the same position, so the account shows a second deposit at a later date`,
        risk: `Smart-contract risk is the risk here: a new protocol can have a bug, so farm only with money you can afford to lose`,
        eligibility: `Programs usually count the position's size over time plus repeat actions, so a second deposit after a week helps more than one deposit`,
      };
  }
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category group, chains, TVL, age), never from a hand-written list
 * of names. Every step names its cost and its time; the last two steps are the risk and the exit.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const gas = gasFor(p);
  const hold = holdDaysFor(age);
  const plan = groupPlan(farmGroup(p), p, capital, chain);
  const chainCount = p.chains.length;
  const extraChain = chainCount > 1 ? ` It also runs on ${chainCount - 1} other chain${chainCount > 2 ? 's' : ''}, so the same wallet can farm a second chain later.` : '';
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline on paper, never in a screenshot or a chat.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: `${plan.core1}.${extraChain}`,
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `${plan.core2}.`,
      cost: '$25 of the same capital and about $' + gas + ' of gas',
      time: '10 minutes',
    },
    {
      text: `Do one qualifying action each week, such as a deposit, a swap, a vote or a claim, and never let the wallet sit idle for a full month.`,
      cost: `about $${gas} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot, and do not withdraw early.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `${plan.eligibility} Before you claim anything, open the protocol's own points or rewards page from its own site and check the wallet is listed.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `${plan.risk} Only use links from the protocol's own site or its verified account; never click a claim link from a direct message, a reply or an ad.`,
      cost: 'nothing, and a scam link costs everything',
      time: '5 minutes to verify',
    },
    {
      text: `Write the wallet, the dates and every transaction hash in a farm log, then plan the exit: withdraw only after the points page confirms the position, and leave gas for the exit transaction.`,
      cost: 'nothing but the log, plus about $' + gas + ' of exit gas',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    watchlist: row.watchlist,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    category_multiplier: row.model.category_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const { byCategory, overall } = categoryMedians(snapshot.protocols);
  const early = board.filter((r) => !r.watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    category_median: byCategory,
    overall_median: overall,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100-row floor`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
