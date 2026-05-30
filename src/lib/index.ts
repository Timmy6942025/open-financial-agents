// Library exports — re-export from submodules for convenience
export { loadCMACookbooks, type LoadedCMA } from "./cma-loader.js";
export { dispatchSubagent } from "./dispatch.js";
export { modelRouter } from "./model-router.js";
export {
  loadAllCMASkills,
  resolveSubagentSkills,
  resolveAgentMarkdownSkills,
  formatSkillsForPrompt,
  type LoadedSkill,
} from "./cma-skill-loader.js";
export { loadCommands } from "./command-loader.js";
export { loadSkills } from "./skill-loader.js";
export { loadAllAgents } from "./agent-loader.js";
export {
  extractHandoff,
  routeHandoff,
  detectCoverageList,
  fanOutCoverageList,
  ALLOWED_TARGETS,
  type HandoffRequest,
} from "../../scripts/orchestrate.js";