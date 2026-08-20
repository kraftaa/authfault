const copyButton = document.querySelector(".copy-button");

copyButton?.addEventListener("click", async () => {
  const code = document.querySelector(".code-card pre code")?.textContent ?? "";
  try {
    await navigator.clipboard.writeText(code);
    copyButton.textContent = "Copied";
    window.setTimeout(() => { copyButton.textContent = "Copy"; }, 1600);
  } catch {
    copyButton.textContent = "Select code";
  }
});
