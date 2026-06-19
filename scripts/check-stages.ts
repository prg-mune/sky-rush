import { checkStageLayouts } from "../shared/stage-layout";

const issues = checkStageLayouts();

if (issues.length > 0) {
  console.error("Stage layout check failed:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log("Stage layout check passed.");
