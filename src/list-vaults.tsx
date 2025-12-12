import { List, ActionPanel, Action, Icon, showToast, Toast, Color, getPreferenceValues } from "@raycast/api";
import { useState, useEffect } from "react";
import { execFile } from "child_process";
import { promisify } from "util";
import { listVaults, listItems, checkAuth } from "./lib/pass-cli";
import { Vault, Item, PassCliError, VaultRole, Preferences } from "./lib/types";
import { getItemIcon } from "./lib/utils";

const execFileAsync = promisify(execFile);

function escapeAppleScriptString(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

const PROTON_PASS_CLI_DOCS = "https://protonpass.github.io/pass-cli/";

function VaultItems({ vault }: { vault: Vault }) {
  const [items, setItems] = useState<Item[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadVaultItems();
  }, []);

  async function loadVaultItems() {
    try {
      const allItems = await listItems(vault.shareId);
      setItems(allItems);
    } catch (error: any) {
      const message = error instanceof PassCliError ? error.message : (error.message || "An unknown error occurred");
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to load items",
        message,
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <List isLoading={isLoading} navigationTitle={vault.name} searchBarPlaceholder="Search items...">
      {items.length === 0 && !isLoading ? (
        <List.EmptyView
          icon={Icon.Folder}
          title="No Items in This Vault"
          description="This vault is empty or contains no visible items."
        />
      ) : (
        items.map((item) => (
          <List.Item
            key={`${item.shareId}-${item.itemId}`}
            icon={getItemIcon(item.type)}
            title={item.title}
            subtitle={item.username || item.email}
            accessories={[
              item.hasTotp ? { icon: Icon.Clock, tooltip: "Has TOTP" } : {},
              { text: item.type },
            ].filter((acc) => Object.keys(acc).length > 0)}
            actions={
              <ActionPanel>
                <Action.CopyToClipboard
                  title="Copy Title"
                  content={item.title}
                  shortcut={{ modifiers: ["cmd"], key: "c" }}
                />
                {item.username && (
                  <Action.CopyToClipboard
                    title="Copy Username"
                    content={item.username}
                    shortcut={{ modifiers: ["cmd", "shift"], key: "u" }}
                  />
                )}
                {item.email && (
                  <Action.CopyToClipboard
                    title="Copy Email"
                    content={item.email}
                    shortcut={{ modifiers: ["cmd", "shift"], key: "e" }}
                  />
                )}
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}

export default function Command() {
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<PassCliError | null>(null);

  useEffect(() => {
    loadVaults();
  }, []);

  async function loadVaults() {
    try {
      const isAuth = await checkAuth();
      if (!isAuth) {
        setError(new PassCliError("Not authenticated. Please log in to Proton Pass.", "not_authenticated"));
        setIsLoading(false);
        return;
      }

      const allVaults = await listVaults();
      setVaults(allVaults);
    } catch (err: any) {
      if (err instanceof PassCliError) {
        setError(err);
      } else {
        setError(new PassCliError(err.message || "An unknown error occurred", "unknown"));
      }
    } finally {
      setIsLoading(false);
    }
  }

  function getRoleIcon(role: VaultRole): Icon {
    switch (role) {
      case "owner":
        return Icon.Crown;
      case "manager":
        return Icon.PersonCircle;
      case "editor":
        return Icon.Pencil;
      case "viewer":
        return Icon.Eye;
      default:
        return Icon.Eye;
    }
  }

  function getRoleColor(role: VaultRole): Color {
    switch (role) {
      case "owner":
        return Color.Yellow;
      case "manager":
        return Color.Blue;
      case "editor":
        return Color.Green;
      case "viewer":
        return Color.SecondaryText;
      default:
        return Color.SecondaryText;
    }
  }

  if (error?.type === "not_installed") {
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

  if (error?.type === "not_authenticated") {
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
                onAction={async () => {
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
                  } catch (error: any) {
                    await showToast({
                      style: Toast.Style.Failure,
                      title: "Failed to open Terminal",
                      message: error.message,
                    });
                  }
                }}
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

  if (error) {
    return (
      <List>
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title="Error Loading Vaults"
          description={error.message}
          actions={
            <ActionPanel>
              <Action title="Retry" icon={Icon.ArrowClockwise} onAction={loadVaults} />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search vaults...">
      {vaults.length === 0 && !isLoading ? (
        <List.EmptyView
          icon={Icon.Folder}
          title="No Vaults Found"
          description="You don't have any vaults yet or they couldn't be loaded."
        />
      ) : (
        vaults.map((vault) => (
          <List.Item
            key={vault.shareId}
            icon={Icon.Folder}
            title={vault.name}
            accessories={[
              { text: `${vault.itemCount} ${vault.itemCount === 1 ? "item" : "items"}` },
              {
                tag: {
                  value: vault.role,
                  color: getRoleColor(vault.role),
                },
                icon: getRoleIcon(vault.role),
                tooltip: `Role: ${vault.role}`,
              },
            ]}
            actions={
              <ActionPanel>
                <Action.Push title="View Items" icon={Icon.List} target={<VaultItems vault={vault} />} />
                <Action.CopyToClipboard
                  title="Copy Vault Name"
                  content={vault.name}
                  shortcut={{ modifiers: ["cmd"], key: "c" }}
                />
                <Action.CopyToClipboard
                  title="Copy Share ID"
                  content={vault.shareId}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "i" }}
                />
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}
