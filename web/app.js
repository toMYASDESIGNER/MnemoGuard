const elements = {
  run: document.querySelector("#run-attack"),
  reset: document.querySelector("#reset-demo"),
  mode: document.querySelector("#mode-label"),
  scenario: document.querySelector("#scenario-state"),
  baselineVerdict: document.querySelector("#baseline-verdict"),
  baselineAction: document.querySelector("#baseline-action"),
  baselineCopy: document.querySelector("#baseline-copy"),
  guardedVerdict: document.querySelector("#guarded-verdict"),
  guardedAction: document.querySelector("#guarded-action"),
  guardedCopy: document.querySelector("#guarded-copy"),
  riskScore: document.querySelector("#risk-score"),
  riskFill: document.querySelector("#risk-fill"),
  reasons: document.querySelector("#reason-list"),
  table: document.querySelector("#memory-table"),
  ledgerCount: document.querySelector("#ledger-count"),
  total: document.querySelector("#metric-total"),
  trusted: document.querySelector("#metric-trusted"),
  review: document.querySelector("#metric-review"),
  quarantined: document.querySelector("#metric-quarantined")
};

async function request(path, options = {}) {
  const response = await fetch(path, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "Request failed");
  return payload;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderState(state) {
  elements.mode.textContent = state.mode === "cockroachdb" ? "CockroachDB Cloud connected" : "Local evidence mode";
  elements.total.textContent = state.counts.total;
  elements.trusted.textContent = state.counts.trusted;
  elements.review.textContent = state.counts.review;
  elements.quarantined.textContent = state.counts.quarantined;
  elements.ledgerCount.textContent = `${state.memories.length} record${state.memories.length === 1 ? "" : "s"}`;
  elements.table.innerHTML = state.memories.map((memory) => `
    <tr>
      <td><span class="state-badge state-${escapeHtml(memory.state)}">${escapeHtml(memory.state)}</span></td>
      <td>${escapeHtml(memory.subject)}</td>
      <td class="claim">${escapeHtml(memory.claim)}</td>
      <td>${escapeHtml(memory.source?.id ?? memory.source?.kind ?? "unknown")}</td>
      <td>${escapeHtml(memory.riskScore)}/100</td>
    </tr>
  `).join("");
}

function renderAttack(result) {
  elements.scenario.textContent = "Attack contained";
  elements.scenario.className = "pill attacked";
  elements.baselineVerdict.textContent = result.baseline.decision.toUpperCase();
  elements.baselineVerdict.className = "verdict executed";
  elements.baselineAction.textContent = result.baseline.action;
  elements.baselineCopy.textContent = result.baseline.explanation;
  elements.guardedVerdict.textContent = result.guarded.decision.toUpperCase();
  elements.guardedVerdict.className = "verdict blocked";
  elements.guardedAction.textContent = result.guarded.action;
  elements.guardedCopy.textContent = "The poisoned record remains in the audit ledger but cannot enter agent context.";
  elements.riskScore.innerHTML = `${result.guarded.riskScore}<span>/100</span>`;
  elements.riskFill.style.width = `${result.guarded.riskScore}%`;
  elements.reasons.innerHTML = result.guarded.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("");
}

function resetOutcome() {
  elements.scenario.textContent = "Ready";
  elements.scenario.className = "pill neutral";
  elements.baselineVerdict.textContent = "WAITING";
  elements.baselineVerdict.className = "verdict waiting";
  elements.baselineAction.textContent = "No action executed yet";
  elements.baselineCopy.textContent = "The baseline agent always trusts the latest retrieved memory.";
  elements.guardedVerdict.textContent = "WAITING";
  elements.guardedVerdict.className = "verdict waiting";
  elements.guardedAction.textContent = "Monitoring memory intake";
  elements.guardedCopy.textContent = "Provenance, policy, conflict, and expiration checks run before recall.";
  elements.riskScore.innerHTML = "0<span>/100</span>";
  elements.riskFill.style.width = "0%";
  elements.reasons.innerHTML = '<li class="placeholder">Run the attack to generate evidence.</li>';
}

async function refresh() {
  renderState(await request("/api/state"));
}

elements.run.addEventListener("click", async () => {
  elements.run.disabled = true;
  elements.run.textContent = "Injecting poisoned memory…";
  try {
    const result = await request("/api/demo/attack", { method: "POST" });
    renderAttack(result);
    await refresh();
  } catch (error) {
    elements.scenario.textContent = error.message;
    elements.scenario.className = "pill attacked";
  } finally {
    elements.run.disabled = false;
    elements.run.innerHTML = "Run poisoning attack <span>→</span>";
  }
});

elements.reset.addEventListener("click", async () => {
  elements.reset.disabled = true;
  try {
    renderState(await request("/api/demo/reset", { method: "POST" }));
    resetOutcome();
  } finally {
    elements.reset.disabled = false;
  }
});

await refresh();
