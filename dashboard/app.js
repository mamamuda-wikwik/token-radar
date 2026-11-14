// Token Radar dashboard (radar-2). Reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, filters, a per-protocol detail view and the farm plan. No network:
// every byte shown is in data.js. The page recomputes each row's implied value from the snapshot
// figures with impliedOf() and checks it against the number board.json carries.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tvl: 'all', growth: 'all', age: 'all', wl: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtDate(s) { return s || 'unknown'; }
  // The model, in one function: the same arithmetic lib/model.ts runs. Size is a power law on TVL
  // (log-scale compression, not linear TVL); growth is clamped momentum; maturity saturates with age;
  // category strength is the category's pre-token TVL median against the overall median; breadth
  // rewards chains. No protocol name is special-cased.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + model.maturity_range * (1 - Math.exp(-Math.max(age, 0) / model.maturity_halflife_days));
    var catMed = (DATA.category_median && DATA.category_median[row.category || 'Other']) || DATA.overall_median;
    var catMult = Math.min(model.category_cap, Math.max(model.category_floor, Math.sqrt(catMed / DATA.overall_median)));
    var breadth = 1 + model.breadth_per_chain * Math.min((row.chains || []).length, model.breadth_max_chains);
    var size = model.size_scale * Math.pow(Math.max(row.tvl_usd, 1), model.size_power);
    return { implied: Math.max(1, Math.round(size * growthMult * maturity * catMult * breadth)), size: Math.round(size), growthMult: growthMult, maturity: maturity, catMult: catMult, breadth: breadth, growth: growth };
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category group, chains, TVL
  // and age decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 1e9) return 200;
    if (p.tvl_usd >= 1e8) return 120;
    if (p.tvl_usd >= 25e6) return 75;
    return 50;
  }
  function gasFor(p) { return chainOf(p) === 'Ethereum' ? 8 : 2; }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 180) return 75;
    if (age < 365) return 60;
    if (age < 730) return 45;
    return 30;
  }
  function farmGroup(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'lending';
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity manager') >= 0) return 'dex';
    if (c.indexOf('bridge') >= 0) return 'bridge';
    if (c.indexOf('stak') >= 0 || c.indexOf('restak') >= 0) return 'staking';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0 || c.indexOf('basis') >= 0) return 'derivatives';
    if (c.indexOf('rwa') >= 0 || c.indexOf('anchor btc') >= 0 || c.indexOf('decentralized btc') >= 0) return 'rwa';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('risk') >= 0) return 'curator';
    if (c.indexOf('stable') >= 0) return 'stable';
    if (c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('farm') >= 0) return 'yield';
    if (c.indexOf('prediction') >= 0) return 'prediction';
    if (c.indexOf('insurance') >= 0) return 'insurance';
    if (c.indexOf('payment') >= 0 || c.indexOf('card') >= 0) return 'payments';
    return 'other';
  }
  function groupPlan(group, p, capital, chain) {
    var n = p.name;
    if (group === 'lending') return { core1: 'Supply $' + capital + ' of USDC to ' + n + ' on ' + chain + ' as collateral, then borrow back $20 of USDC against it so both sides of the book are active', core2: 'Repay half the borrow after a week and re-supply the freed collateral, so the position shows two separate qualifying actions', risk: 'Liquidation is the risk here: keep the loan-to-value under 50% and never borrow the maximum, or a price dip can close the position', eligibility: 'Lending points usually count supplied time, not just size, so a smaller position held for weeks can outrank a large one held for a day' };
    if (group === 'dex') return { core1: 'Provide $' + capital + ' of liquidity to ' + n + "'s deepest pool on " + chain + ', in a balanced pair, and keep the position in range', core2: 'Swap $10 through ' + n + ' on ' + chain + ' once a week, alternating the direction, so trading volume is recorded as well as liquidity', risk: 'Impermanent loss is the risk here: a narrow range earns more fees but can go out of range and stop earning, so check the range weekly', eligibility: 'DEX rewards usually count both liquidity time and swap volume, so the weekly swap matters as much as the deposit itself' };
    if (group === 'bridge') return { core1: 'Bridge $' + capital + ' of USDC into ' + chain + ' through ' + n + ', then use the bridged funds inside an app on that chain instead of bridging straight back', core2: 'A week later bridge $25 back through ' + n + ' on a different route or to a second chain, so the history shows repeat use, not one round trip', risk: 'Bridging risk is the risk here: a bridge moves funds across chains, so start with the smallest amount the route accepts and verify the receipt before sending more', eligibility: 'Bridge programs usually count volume and repeat crossings, and a same-day round trip is often filtered out as wash volume' };
    if (group === 'staking') return { core1: "Stake $" + capital + " of the chain's staking asset through " + n + ' on ' + chain + ' and hold the liquid receipt token it issues', core2: 'Use $25 of the receipt token in a lending or liquidity pool on ' + chain + ', so the position is staked and deployed at the same time', risk: 'Slashing and depeg are the risks here: the receipt token can trade below the staked asset, so watch its peg before adding more', eligibility: 'Staking programs usually count the staked balance over time, so unstaking early can reset the clock even if the amount was large' };
    if (group === 'derivatives') return { core1: 'Deposit $' + capital + ' of USDC as margin on ' + n + ' on ' + chain + ' and open one small hedged position, sized under 10% of the margin', core2: 'Close the hedge after a few days and open a fresh one in the opposite direction, so the account shows two settled trades', risk: 'Liquidation is the risk here: keep leverage under 2x and the position small, or a fast move can wipe the margin', eligibility: 'Perp programs usually count trading volume and open interest over time, so one large trade counts less than steady small ones' };
    if (group === 'rwa') return { core1: "Mint $" + capital + " of " + n + "'s yield-bearing asset on " + chain + ' and hold it in the farming wallet for the full hold period', core2: 'After two weeks, add $25 more of the same asset so the position shows a second purchase at a later date', risk: 'Issuer and custody risk are the risks here: a real-world asset depends on its issuer and custodian, so read who holds the underlying before minting', eligibility: 'RWA programs usually count holding time and the number of mints, so a second purchase after two weeks helps more than one large mint' };
    if (group === 'curator') return { core1: 'Deposit $' + capital + ' into a ' + n + ' vault on ' + chain + ' and hold the vault shares for the full hold period', core2: 'After two weeks move $25 of the shares into a second vault of ' + n + ' on the same chain, so the account shows two vaults', risk: "Vault-strategy risk is the risk here: a curator's vault can change strategy, so check the vault's current allocation before depositing", eligibility: 'Curator programs usually count vault shares held over time across vaults, so splitting across two vaults can count better than one' };
    if (group === 'stable') return { core1: 'Mint $' + capital + ' of the stable asset through ' + n + ' on ' + chain + ' and hold it in the farming wallet', core2: 'Use $25 of the minted stablecoin in a lending pool on ' + chain + ', so the position is minted and in use at the same time', risk: 'Depeg is the risk here: a stable asset can trade below its peg, so check its price and backing before minting a large amount', eligibility: 'Stablecoin programs usually count minted supply held over time, so holding through a full month counts more than a same-day mint and burn' };
    if (group === 'yield') return { core1: "Deposit $" + capital + " into " + n + "'s highest-yield vault on " + chain + ' and leave the position compounding', core2: 'After a week, claim the accrued yield and re-deposit it into the same vault, so the account shows a harvest and a re-deposit', risk: "Strategy risk is the risk here: a yield vault's strategy can change or pause, so check the vault's current APY and strategy before depositing", eligibility: 'Yield programs usually count deposits held over time plus harvests, so the weekly claim-and-redeposit helps more than a single deposit' };
    if (group === 'prediction') return { core1: 'Fund $' + capital + ' on ' + n + ' and place one $10 position on a market that resolves after the hold period', core2: 'Place a second $10 position on a different market the following week, so the account shows two markets, not one bet', risk: 'Total loss on a wrong outcome is the risk here: keep each position small and never stake the whole balance on one market', eligibility: 'Prediction programs usually count the number of markets traded and volume, so two small positions beat one large one' };
    if (group === 'insurance') return { core1: 'Buy $' + capital + ' of cover from ' + n + ' on ' + chain + ' for a protocol you already use, and keep the policy active', core2: 'After two weeks, extend the same policy by $25 or buy cover for a second protocol, so the account shows repeat cover', risk: 'Claim-denial risk is the risk here: cover pays only for the events its policy names, so read the covered events before buying', eligibility: 'Insurance programs usually count active cover over time, so a policy held for weeks counts more than a same-day buy and cancel' };
    if (group === 'payments') return { core1: 'Move $' + capital + ' into ' + n + ' on ' + chain + ' and make one real payment or top-up through it, then keep a balance for the hold period', core2: 'Make a second small payment the following week, so the account shows repeat use rather than a single top-up', risk: 'Counterparty risk is the risk here: funds sit with the provider, so keep only the farming amount in the account', eligibility: 'Payments programs usually count transaction count and volume, so two small payments beat one large top-up' };
    return { core1: 'Deposit $' + capital + ' of USDC into ' + n + ' on ' + chain + ' and keep the position open for the full hold period', core2: 'After a week, add $25 more to the same position, so the account shows a second deposit at a later date', risk: 'Smart-contract risk is the risk here: a new protocol can have a bug, so farm only with money you can afford to lose', eligibility: 'Programs usually count the position\'s size over time plus repeat actions, so a second deposit after a week helps more than one deposit' };
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var gas = gasFor(p);
    var hold = holdDaysFor(p.age_days);
    var plan = groupPlan(farmGroup(p), p, capital, chain);
    var chainCount = (p.chains || []).length;
    var extraChain = chainCount > 1 ? ' It also runs on ' + (chainCount - 1) + ' other chain' + (chainCount > 2 ? 's' : '') + ', so the same wallet can farm a second chain later.' : '';
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline on paper, never in a screenshot or a chat.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: plan.core1 + '.' + extraChain, cost: '$' + capital + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up' },
      { text: plan.core2 + '.', cost: '$25 of the same capital and about $' + gas + ' of gas', time: '10 minutes' },
      { text: 'Do one qualifying action each week, such as a deposit, a swap, a vote or a claim, and never let the wallet sit idle for a full month.', cost: 'about $' + gas + ' of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot, and do not withdraw early.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: plan.eligibility + " Before you claim anything, open the protocol's own points or rewards page from its own site and check the wallet is listed.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: plan.risk + " Only use links from the protocol's own site or its verified account; never click a claim link from a direct message, a reply or an ad.", cost: 'nothing, and a scam link costs everything', time: '5 minutes to verify' },
      { text: 'Write the wallet, the dates and every transaction hash in a farm log, then plan the exit: withdraw only after the points page confirms the position, and leave gas for the exit transaction.', cost: 'nothing but the log, plus about $' + gas + ' of exit gas', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tvl')) state.tvl = params.get('tvl');
    if (params.get('growth')) state.growth = params.get('growth');
    if (params.get('age')) state.age = params.get('age');
    if (params.get('wl') === '1') state.wl = true;
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tvl !== 'all') params.set('tvl', state.tvl);
    if (state.growth !== 'all') params.set('growth', state.growth);
    if (state.age !== 'all') params.set('age', state.age);
    if (state.wl) params.set('wl', '1');
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.wl && !r.watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.tvl === 'b1' && r.tvl_usd < 1e9) return false;
      if (state.tvl === 'm100' && (r.tvl_usd < 1e8 || r.tvl_usd >= 1e9)) return false;
      if (state.tvl === 'm50' && (r.tvl_usd < 5e7 || r.tvl_usd >= 1e8)) return false;
      if (state.tvl === 'early' && r.tvl_usd >= 5e7) return false;
      if (state.growth === 'pos' && !(r.change_7d !== null && r.change_7d > 0)) return false;
      if (state.growth === 'hot' && !(r.change_7d !== null && r.change_7d > 10)) return false;
      if (state.growth === 'neg' && !(r.change_7d !== null && r.change_7d < 0)) return false;
      var age = r.age_days;
      if (state.age === 'young' && !(age !== null && age < 180)) return false;
      if (state.age === 'mid' && !(age !== null && age >= 180 && age < 365)) return false;
      if (state.age === 'old' && !(age !== null && age >= 365 && age < 730)) return false;
      if (state.age === 'vet' && !(age !== null && age >= 730)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name' }, el('b', { text: 'Token' }), document.createTextNode(' Radar'))),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'DefiLlama protocol index'),
        el('span', null, 'Model ', el('b', { text: DATA.model_version }))
      )
    );
  }

  function lede() {
    var top = DATA.rows[0];
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by what their launch would be worth' }),
        el('p', null,
          'The watchlist is the floor: every protocol with at least ', el('b', { text: '$' + Math.round(DATA.floor_usd / 1e6) + 'M' }),
          ' of TVL that records no token. The early radar adds ', el('b', { text: String(DATA.early_size) }),
          ' pre-token protocols below that floor. Rank 1 is ', el('b', { text: top ? top.name : '' }),
          ' at ', el('b', { text: top ? fmtUsd(top.implied_value_usd) : '' }),
          ' of implied value. Implied value is a model, not a promise — and it is not a prediction that a token will launch.'
        )
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function top5() {
    var list = DATA.rows.slice(0, 5);
    return el('div', { class: 'top5' }, list.map(function (r) {
      return el('button', { type: 'button', class: 'spot', onclick: function () { openDetail(r.slug); } },
        el('span', { class: 'rank', text: '#' + r.rank + (r.watchlist ? ' · WATCHLIST' : ' · EARLY') }),
        el('b', { text: r.name }),
        el('span', { class: 'val', text: fmtUsd(r.implied_value_usd) }),
        el('span', { class: 'sub', text: 'TVL ' + fmtUsd(r.tvl_usd) + ' · 7d ' + fmtPct(r.change_7d) })
      );
    }));
  }

  function selectField(id, label, value, options, onChange) {
    var sel = el('select', { id: id, 'aria-label': label },
      options.map(function (o) { return el('option', { value: o[0], text: o[1], selected: o[0] === value ? 'selected' : null }); })
    );
    sel.addEventListener('change', function () { onChange(sel.value); writeHash(); render(); });
    return el('div', { class: 'field' }, el('label', { for: id, text: label }), sel);
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category, chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var wl = el('label', { class: 'check' },
      el('input', { type: 'checkbox', checked: state.wl ? 'checked' : null, 'aria-label': 'Watchlist only' }),
      document.createTextNode('Watchlist only')
    );
    wl.querySelector('input').addEventListener('change', function (e) { state.wl = e.target.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      selectField('category', 'Category', state.category, [['all', 'All categories']].concat(categories.map(function (c) { return [c, c]; })), function (v) { state.category = v; }),
      selectField('chain', 'Chain', state.chain, [['all', 'All chains']].concat(chains.map(function (c) { return [c, c]; })), function (v) { state.chain = v; }),
      selectField('tvl', 'TVL', state.tvl, [['all', 'Any TVL'], ['b1', '$1B and up'], ['m100', '$100M – $1B'], ['m50', '$50M – $100M'], ['early', 'Under $50M (early)']], function (v) { state.tvl = v; }),
      selectField('growth', '7-day growth', state.growth, [['all', 'Any growth'], ['pos', 'Growing (> 0%)'], ['hot', 'Hot (> +10%)'], ['neg', 'Falling (< 0%)']], function (v) { state.growth = v; }),
      selectField('age', 'Age with no token', state.age, [['all', 'Any age'], ['young', 'Under 6 months'], ['mid', '6 – 12 months'], ['old', '1 – 2 years'], ['vet', 'Over 2 years']], function (v) { state.age = v; }),
      wl,
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' of ' + DATA.board_size + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category, chain or range to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.tvl = 'all'; state.growth = 'all'; state.age = 'all'; state.wl = false; writeHash(); render(); } })
      ));
    }
    var max = DATA.rows[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') + (r.chains && r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: r.watchlist ? 'badge watch' : 'badge early', text: r.watchlist ? 'Watchlist' : 'Early' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Board' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'badge live', text: 'Live' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'sub', text: 'already trades — market cap, not a model' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One function scores every protocol from the snapshot figures alone. No protocol name is special-cased, and no row is hand-picked. A protocol records no token — DefiLlama’s record is not proof it has none.' }),
      el('div', { class: 'formula' },
        el('b', { text: 'implied = round( ' }),
        document.createTextNode(m.size_scale + ' × tvl_usd^' + m.size_power + ' × (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 × ' + m.growth_weight + ') × (' + m.maturity_floor + ' + ' + m.maturity_range + ' × (1 − e^(−age_days / ' + m.maturity_halflife_days + '))) × category × breadth )'),
        el('b', { text: ' )' })
      ),
      el('div', { class: 'model-grid' },
        el('div', { class: 'model-cell' }, el('b', { text: 'TVL^' + m.size_power }), el('span', { text: 'Power-law size: a 10x TVL gap is ~6.3x value, so growth and maturity can re-order the board' })),
        el('div', { class: 'model-cell' }, el('b', { text: 'Growth ×' + m.growth_weight }), el('span', { text: '7-day TVL momentum, clamped to −50% … +100% so one wild print cannot win the board' })),
        el('div', { class: 'model-cell' }, el('b', { text: 'Maturity 0.75 – 1.10' }), el('span', { text: 'Age since first listed: time run with no token, saturating over ~3 years; unknown age counts as 365 days' })),
        el('div', { class: 'model-cell' }, el('b', { text: 'Category 0.85 – 1.18' }), el('span', { text: 'Square root of the category’s pre-token TVL median over the overall median (' + fmtUsd(DATA.overall_median) + ')' })),
        el('div', { class: 'model-cell' }, el('b', { text: 'Breadth 1.02 – 1.16' }), el('span', { text: '+2% per chain, up to 8 chains: multi-chain reach is worth more at launch' }))
      ),
      el('p', { class: 'sub', text: 'The early radar is every rankable pre-token protocol below the watchlist floor, not just the biggest few. Live-token protocols are set aside with their market caps shown.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var calc = impliedOf(row, DATA.model);
    var match = calc.implied === row.implied_value_usd;
    var max = DATA.rows[0].implied_value_usd || 1;
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: row.watchlist ? 'badge watch' : 'badge early', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' · ' + (row.watchlist ? 'Watchlist' : 'Early') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' · listed ' + fmtDate(row.listed_at) })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'implied' },
        el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((row.implied_value_usd / max) * 100)) + '%' })),
        el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })
      ),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Size base (12 × TVL^0.8)' }), el('b', { class: 'num', text: fmtUsd(calc.size) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) + ' → ×' + calc.growthMult.toFixed(3) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) + ' → ×' + calc.maturity.toFixed(3) })),
        el('div', null, el('span', { text: 'Category multiplier' }), el('b', { class: 'num', text: '×' + calc.catMult.toFixed(3) })),
        el('div', null, el('span', { text: 'Chain breadth (' + (row.chains || []).length + ' chains)' }), el('b', { class: 'num', text: '×' + calc.breadth.toFixed(3) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: match ? 'check-line' : 'check-line bad', text: match ? 'Recomputed on this page: ' + fmtUsd(calc.implied) + ' — matches board.json.' : 'Recomputed on this page: ' + fmtUsd(calc.implied) + ' — differs from board.json; the data would be stale.' }),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. This is an estimate of what a launch would be worth if the record stayed as it is — not a price, and not a prediction that a token will launch.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan — 8 steps with cost and time' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    if (state.tab === 'pre-token') shell.appendChild(top5());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(el('p', { class: 'note', text: 'Source: ' + DATA.source + '. Snapshot ' + DATA.as_of + '. A protocol is described as recording no token when DefiLlama’s record carries none — the record is not proof it has none.' }));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
