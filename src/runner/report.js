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
      if (result.outcome === "survived") {
        console.log(`    why it matters: ${survivorExplanation(result)}`);
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

export function formatGitHubSummary(points, results) {
  const protectedCount = results.filter((result) => result.outcome === "killed").length;
  const gapResults = results.filter(
    (result) =>
      result.outcome === "survived" &&
      !result.reviewed &&
      !result.possibleCompensatingControls?.length
  );
  const reviewResults = results.filter(
    (result) =>
      ["inconclusive", "flaky"].includes(result.outcome) ||
      (result.outcome === "survived" &&
        !result.reviewed &&
        result.possibleCompensatingControls?.length)
  );
  const reviewedCount = results.filter(
    (result) => result.outcome === "survived" && result.reviewed
  ).length;

  const lines = [
    "## AuthFault authorization test",
    "",
    `Tested **${results.length} authorization faults** across **${points.length} enforcement points**.`,
    "",
    `- ✅ **${protectedCount} protected** — tests detected the changed decision`,
    `- ❌ **${gapResults.length} enforcement gap${gapResults.length === 1 ? "" : "s"}** — tests still passed`,
    `- ⚠️ **${reviewResults.length} need${reviewResults.length === 1 ? "s" : ""} review** — result was compensated, flaky, or inconclusive`,
    `- 📝 **${reviewedCount} reviewed** — accepted through the survivor baseline`
  ];

  if (gapResults.length > 0 || reviewResults.length > 0) {
    lines.push("", "| Point | Result | Injected fault |", "| --- | --- | --- |");
    for (const result of [...gapResults, ...reviewResults]) {
      const direction = result.decision === "allow" ? "forced allow" : "forced deny";
      const label = gapResults.includes(result)
        ? `Enforcement gap (${direction})`
        : `Needs review (${direction})`;
      lines.push(`| \`${escapeMarkdown(result.id)}\` | ${label} | ${escapeMarkdown(result.fault)} |`);
    }
  }

  lines.push(
    "",
    "> An enforcement gap is a reason to investigate, not proof of a vulnerability.",
    ""
  );
  return lines.join("\n");
}

export function survivorExplanation(result) {
  if (result.decision === "allow") {
    return "tests did not detect a forced allow; verify that another control intentionally blocks access or add a negative assertion";
  }
  return "tests did not detect a forced deny; this authorization result may not control the operation's behavior";
}

export function formatGitHubAnnotations(results) {
  return results
    .filter((result) => result.outcome === "survived" && !result.reviewed)
    .map((result) => {
      const title = result.possibleCompensatingControls?.length
        ? "AuthFault result needs review"
        : "AuthFault enforcement gap";
      return `::warning title=${escapeWorkflowCommand(title)}::${escapeWorkflowCommand(`${result.id}: ${result.fault}`)}`;
    });
}

function escapeMarkdown(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("`", "\\`");
}

function escapeWorkflowCommand(value) {
  return String(value)
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}
