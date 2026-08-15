import { Plugin } from "@opencode-ai/plugin";
import { fileURLToPath } from "node:url";
import { DSH_MINIMAL_SYSTEM_PROMPT, DSH_MINIMAL_TOOLS } from "./dsh/constants.generated.ts";
import { PersistentBash } from "./tools/persistent-bash.ts";
import { StrReplaceEditor } from "./tools/str-replace-editor.ts";
import { compositionFor, loadSettings } from "./config.ts";
import { SessionStore } from "./state.ts";

const SETTINGS_FILE = fileURLToPath(new URL("../../seek-anchor.json", import.meta.url));
const BASH_DEFINITION = DSH_MINIMAL_TOOLS[0];
const EDITOR_DEFINITION = DSH_MINIMAL_TOOLS[1];

export function createSeekAnchorPlugin(settingsFile: string = SETTINGS_FILE) {
  return Plugin.define({
    id: "seekanchor.runtime",
    setup: async (ctx) => {
      const mountedSettings = loadSettings(settingsFile);
      const mountedBashBackend = mountedSettings.bashBackend;
      const minimalToolNames = new Set([
        mountedBashBackend === "opencode" ? "shell" : "bash",
        "str_replace_editor",
      ]);
      const sessions = new SessionStore();
      const shells = new Map<string, PersistentBash>();
      const editors = new Map<string, StrReplaceEditor>();
      const directories = new Map<string, string>();

      const directoryFor = async (sessionID: string): Promise<string> => {
        const cached = directories.get(sessionID);
        if (cached) return cached;
        const session = await ctx.session.get({ sessionID });
        const directory = session.location.directory;
        directories.set(sessionID, directory);
        return directory;
      };

      const shellFor = async (sessionID: string): Promise<PersistentBash> => {
        let shell = shells.get(sessionID);
        if (!shell) {
          shell = new PersistentBash({ cwd: await directoryFor(sessionID) });
          shells.set(sessionID, shell);
        }
        return shell;
      };

      const editorFor = async (sessionID: string): Promise<StrReplaceEditor> => {
        let editor = editors.get(sessionID);
        if (!editor) {
          editor = new StrReplaceEditor(await directoryFor(sessionID));
          editors.set(sessionID, editor);
        }
        return editor;
      };

      await ctx.tool.transform((tools) => {
        if (mountedBashBackend === "dsh") {
          tools.add({
            name: BASH_DEFINITION.name,
            description: BASH_DEFINITION.description,
            input: BASH_DEFINITION.parameters,
            options: { codemode: false },
            execute: async (input, toolContext) => {
              const command = (input as { command?: unknown }).command;
              if (typeof command !== "string") throw new Error("command must be a string");
              return {
                content: await (await shellFor(toolContext.sessionID)).exec(command),
              };
            },
          });
        }

        tools.add({
          name: EDITOR_DEFINITION.name,
          description: EDITOR_DEFINITION.description,
          input: EDITOR_DEFINITION.parameters,
          options: { codemode: false },
          execute: async (input, toolContext) => ({
            content: await (await editorFor(toolContext.sessionID)).execute(input as never),
          }),
        });
      });

      await ctx.session.hook("context", (event) => {
        const settings = loadSettings(settingsFile);
        const state = sessions.syncSettings(event.sessionID, settings);
        state.requests += 1;
        const composition = compositionFor(settings, state.anchorState);

        if (composition.system === "minimal") {
          event.system.splice(0, event.system.length, {
            type: "text",
            text: DSH_MINIMAL_SYSTEM_PROMPT,
          });
        }

        if (composition.tools === "minimal") {
          if (mountedBashBackend === "opencode" && event.tools.shell) {
            event.tools.shell.description = BASH_DEFINITION.description;
            event.tools.shell.input = BASH_DEFINITION.parameters;
          }
          for (const name of Object.keys(event.tools)) {
            if (!minimalToolNames.has(name)) delete event.tools[name];
          }
        }
      });

      await ctx.tool.hook("execute.after", (event) => {
        if (event.status !== "completed") return;
        const settings = loadSettings(settingsFile);
        sessions.recordSuccessfulTool(event.sessionID, event.tool, settings);
      });

      return async () => {
        await Promise.all([...shells.values()].map((shell) => shell.dispose()));
        shells.clear();
        editors.clear();
        directories.clear();
        sessions.clear();
      };
    },
  });
}

export default createSeekAnchorPlugin();
