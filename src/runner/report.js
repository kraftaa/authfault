export function printReport(points, results, confirmKills, baselineSummary) {
  console.log("Authorization fault-injection report\n");
  for (const point of points) {
    console.log(point.id);
    console.log(`  observed allow: ${point.allowCount}`);
    console.log(`  observed deny:  ${point.denyCount}`);
    if (point.allowCount === 0) console.log("  MISSING COVERAGE: no allowed decision was observed");
    if (point.denyCount === 0) console.log("  MISSING COVERAGE: no denied decision was observed");

    for (const result of results.filter((item) => item.id === point.id)) {
      const hasCompensation = result.possibleCompensatingControls?.length > 0;
      let marker = hasCompensation
        ? "REVIEW NEEDED (SURVIVED WITH POSSIBLE COMPENSATING CONTROL)"
        : {
            killed: "PROTECTED (KILLED)",
            survived: "ENFORCEMENT GAP (SURVIVED)",
            inconclusive: "COULD NOT VERIFY (INCONCLUSIVE)",
            flaky: "UNSTABLE RESULT (FLAKY)"
          }[result.outcome] ?? result.outcome.toUpperCase();
      if (result.outcome === "survived" && result.reviewed) {
        marker += " — REVIEWED";
      } else if (result.reviewStatus === "invalid") {
        marker += result.reviewProblems.some((problem) => problem.includes("expired"))
          ? " — REVIEW EXPIRED"
          : " — REVIEW INCOMPLETE";
      }
      console.log(`  ${marker}: ${result.fault}`);
      console.log(
        result.targeted
          ? `    reran ${result.tests.length} attributed test(s)`
          : "    reran the full test command (unattributed decisions present)"
      );
      if (result.occurrence) {
        console.log(
          result.testId
            ? `    occurrence ${result.occurrence} in ${result.testId}`
            : `    occurrence ${result.occurrence} in the unattributed decision stream`
        );
      }
      if (result.outcome === "killed") {
        console.log(`    confirmed by ${confirmKills} failing mutation run(s)`);
      }
      if (hasCompensation) {
        console.log(`    another denial observed at: ${result.possibleCompensatingControls.join(", ")}`);
      }
      if (result.reviewProblems?.length > 0) {
        console.log(`    review: ${result.reviewProblems.join("; ")}`);
      }
      if (result.reason) console.log(`    reason: ${result.reason}`);
    }
    console.log("");
  }

  const count = (outcome) => results.filter((result) => result.outcome === outcome).length;
  const killed = count("killed");
  const survived = count("survived");
  const inconclusive = count("inconclusive");
  const flaky = count("flaky");
  console.log(
    `Summary: ${points.length} points, ${results.length} faults, ${killed} killed, ${survived} survived, ${inconclusive} inconclusive, ${flaky} flaky`
  );
  if (survived > 0) {
    console.log(
      `Survivors: ${baselineSummary.new} new, ${baselineSummary.invalid.length} invalid review, ${baselineSummary.reviewed} reviewed`
    );
    console.log(
      "\nAn enforcement gap means the test suite did not detect the injected fault. It is a reason to investigate, not proof of a vulnerability. Another denial in the same operation is evidence of a possible compensating control, not proof of safety."
    );
  }
  if (baselineSummary.stale.length > 0) {
    console.log(
      `\nSTALE BASELINE: ${baselineSummary.stale.length} baseline entry or entries were not observed`
    );
    for (const entry of baselineSummary.stale) {
      const scope = entry.occurrence
        ? ` occurrence ${entry.occurrence}${entry.testId ? ` in ${entry.testId}` : ""}`
        : "";
      console.log(`  ${entry.id}: force ${entry.decision}${scope}`);
    }
  }
}
