import { List, ActionPanel, Action, Icon, showToast, Toast, getPreferenceValues } from "@raycast/api";
import { useState, useEffect } from "react";
import { execFile } from "child_process";
import { promisify } from "util";
import { checkAuth } from "./lib/pass-cli";
import { Preferences, PassCliError } from "./lib/types";

const execFileAsync = promisify(execFile);

function escapeAppleScriptString(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

const PROTON_PASS_CLI_DOCS = "https://protonpass.github.io/pass-cli/";

type AuthState = "loading" | "not-installed" | "not-authenticated" | "authenticated";

export default function Command() {
  const [authState, setAuthState] = useState<AuthState>("loading");

  useEffect(() => {
    async function verifyAuth() {
      try {
        const isAuthenticated = await checkAuth();
        setAuthState(isAuthenticated ? "authenticated" : "not-authenticated");
      } catch (error) {
        if (error instanceof PassCliError) {
          if (error.type === "not_installed") {
            setAuthState("not-installed");
            return;
          }
          if (error.type === "not_authenticated") {
            setAuthState("not-authenticated");
            return;
          }
        }
        await showToast({
          style: Toast.Style.Failure,
          title: "Error checking authentication status",
          message: error instanceof Error ? error.message : String(error),
        });
        setAuthState("not-authenticated");
      }
    }

    verifyAuth();
  }, []);

  const handleOpenTerminalForLogin = async () => {
    const preferences = getPreferenceValues<Preferences>();
    const cliPath = preferences.cliPath || "pass-cli";
    const escapedCliPath = escapeAppleScriptString(cliPath);
    try {
      await execFileAsync("osascript", ["-e", `tell application "Terminal" to do script "${escapedCliPath} login"`]);
      await showToast({
        style: Toast.Style.Success,
        title: "Terminal opened",
        message: "Please complete login in Terminal",
      });
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to open Terminal",
        message: String(error),
      });
    }
  };

  if (authState === "loading") {
    return <List isLoading={true} />;
  }

  if (authState === "not-installed") {
    return (
      <List>
        <List.EmptyView
          icon={Icon.XMarkCircle}
          title="Proton Pass CLI Not Installed"
          description="You need to install the Proton Pass CLI to use this extension. Click below to learn how to install it."
          actions={
            <ActionPanel>
              <Action.OpenInBrowser
                title="Open Installation Guide"
                url={PROTON_PASS_CLI_DOCS}
                icon={Icon.Globe}
              />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  if (authState === "not-authenticated") {
    return (
      <List>
        <List.EmptyView
          icon={Icon.Lock}
          title="Not Logged In"
          description="You need to login via terminal to use Proton Pass. Click below to open Terminal and run the login command."
          actions={
            <ActionPanel>
              <Action
                title="Open Terminal to Login"
                icon={Icon.Terminal}
                onAction={handleOpenTerminalForLogin}
              />
              <Action.OpenInBrowser
                title="View CLI Documentation"
                url={PROTON_PASS_CLI_DOCS}
                icon={Icon.Globe}
                shortcut={{ modifiers: ["cmd"], key: "d" }}
              />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  return (
    <List>
      <List.EmptyView
        icon={Icon.CheckCircle}
        title="You're Logged In"
        description="You are successfully authenticated with Proton Pass. You can now use other commands to search and manage your vaults."
        actions={
          <ActionPanel>
            <Action.OpenInBrowser
              title="View CLI Documentation"
              url={PROTON_PASS_CLI_DOCS}
              icon={Icon.Globe}
              shortcut={{ modifiers: ["cmd"], key: "d" }}
            />
          </ActionPanel>
        }
      />
    </List>
  );
}
