import { describe, expect, it } from "vitest";
import { buildBaselineState } from "../src/data/seed";
import { ils } from "../src/domain/money";
import { costLineView, portfolioTotals, projectTotals, categoryCoverage, contractRemainingPayment } from "../src/domain/selectors/financial";

describe("baseline seed", () => {
  const state = buildBaselineState("test");

  it("derives every cost code's A/C/R/paid from the ledger and matches the seed checksum", () => {
    for (const code of state.costCodes) {
      const line = costLineView(state, code.id);
      expect(line.incurred, `${code.id} incurred`).toBe(code.seedCheck.incurred);
      expect(line.commitments, `${code.id} commitments`).toBe(code.seedCheck.remainingCommitment);
      expect(line.uncommitted, `${code.id} uncommitted`).toBe(code.seedCheck.remainingUncommitted);
      expect(line.paid, `${code.id} paid`).toBe(code.seedCheck.paid);
    }
  });

  it("matches the Section 5.1 project totals", () => {
    const had = projectTotals(state, "HAD");
    expect(had.budget).toBe(ils(6100000));
    expect(had.incurred).toBe(ils(1606000));
    expect(had.commitments).toBe(ils(1830000));
    expect(had.uncommitted).toBe(ils(2670000));
    expect(had.eac).toBe(ils(6106000));
    expect(had.paid).toBe(ils(1250000));
    expect(had.variance).toBe(ils(6000));

    const par = projectTotals(state, "PAR");
    expect(par.eac).toBe(ils(3998000));
    expect(par.variance).toBe(ils(-2000));
    expect(par.paid).toBe(ils(858000));

    expect(projectTotals(state, "GAN").eac).toBe(ils(3000000));
    expect(projectTotals(state, "YAM").eac).toBe(ils(2000000));

    const portfolio = portfolioTotals(state);
    expect(portfolio.budget).toBe(ils(15100000));
    expect(portfolio.incurred).toBe(ils(4184000));
    expect(portfolio.commitments).toBe(ils(4950000));
    expect(portfolio.uncommitted).toBe(ils(5970000));
    expect(portfolio.eac).toBe(ils(15104000));
    expect(portfolio.paid).toBe(ils(3358000));
    expect(portfolio.variance).toBe(ils(4000));
  });

  it("excludes the NOF draft from the portfolio", () => {
    expect(state.projects.find((p) => p.id === "NOF")?.status).toBe("draft");
    expect(state.costCodes.some((c) => c.projectId === "NOF")).toBe(false);
  });

  it("shows fulfilled purchase orders with zero remaining commitment", () => {
    const h10 = costLineView(state, "H10");
    const po = h10.commitmentViews.find((c) => c.commitmentId === "PO-H-STEEL-001");
    expect(po?.remaining).toBe(0);
    expect(h10.quantities?.purchasedVerified).toBe(20);
    expect(h10.quantities?.remainingToProcure).toBe(480);
    expect(h10.quantities?.delivered).toBe(20);
  });

  it("answers the subcontract remaining payment as 50,000 + 800,000", () => {
    const pay = contractRemainingPayment(state, "CT-H-FRAME");
    expect(pay.unpaidRecognized).toBe(ils(50000));
    expect(pay.remainingCommitment).toBe(ils(800000));
    expect(pay.total).toBe(ils(850000));
  });

  it("reports company steel only where detail exists", () => {
    const cov = categoryCoverage(state, "steel");
    expect(cov.subtotal).toBe(ils(124000));
    expect(cov.aggregateOnlyProjectIds.sort()).toEqual(["GAN", "YAM"]);
  });

  it("every document referenced by a record or work item exists", () => {
    const ids = new Set(state.documents.map((d) => d.id));
    for (const r of state.erpRecords) {
      if (r.sourceDocumentId) expect(ids.has(r.sourceDocumentId), r.sourceDocumentId).toBe(true);
      for (const rel of r.relatedDocumentIds) expect(ids.has(rel), rel).toBe(true);
    }
    for (const w of state.workItems) if (w.sourceDocumentId) expect(ids.has(w.sourceDocumentId), w.sourceDocumentId).toBe(true);
    for (const c of state.commitments) if (c.documentId) expect(ids.has(c.documentId), c.documentId).toBe(true);
  });
});
