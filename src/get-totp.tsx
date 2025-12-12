import { List, ActionPanel, Action, Icon, showToast, Toast, Clipboard, Color } from "@raycast/api";
import { useState, useEffect, useRef } from "react";
import { listItems, getTotp, checkAuth } from "./lib/pass-cli";
import { Item, PassCliError } from "./lib/types";
import { getItemIcon, getTotpRemainingSeconds, formatTotpCode } from "./lib/utils";

const PROTON_PASS_CLI_DOCS = "https://protonpass.github.io/pass-cli/";

interface TotpItem extends Item {
  currentTotp?: string;
}

export default function Command() {
  const [items, setItems] = useState<TotpItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(getTotpRemainingSeconds());
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout>();
  const itemsRef = useRef<TotpItem[]>([]);

  useEffect(() => {
    loadTotpItems();

    // Update countdown every second
    intervalRef.current = setInterval(() => {
      const newRemaining = getTotpRemainingSeconds();
      setRemainingSeconds(newRemaining);

      // Refresh TOTP codes when timer resets
      if (newRemaining === 30) {
        refreshTotpCodes();
      }
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  async function loadTotpItems() {
    try {
      const isAuth = await checkAuth();
      if (!isAuth) {
        setError("not_authenticated");
        setIsLoading(false);
        return;
      }

      const allItems = await listItems();
      const totpItems = allItems.filter(item => item.hasTotp);

      // Fetch TOTP codes for all items
      const itemsWithTotp = await Promise.all(
        totpItems.map(async (item) => {
          try {
            const totp = await getTotp(item.shareId, item.itemId);
            return { ...item, currentTotp: totp };
          } catch {
            return { ...item, currentTotp: undefined };
          }
        })
      );

      setItems(itemsWithTotp);
      itemsRef.current = itemsWithTotp;
    } catch (e: any) {
      if (e instanceof PassCliError && e.type === "not_installed") {
        setError("not_installed");
      } else if (e instanceof PassCliError && e.type === "not_authenticated") {
        setError("not_authenticated");
      } else {
        showToast({ style: Toast.Style.Failure, title: "Failed", message: e.message });
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function refreshTotpCodes() {
    setIsRefreshing(true);
    try {
      const currentItems = itemsRef.current;
      const updatedItems = await Promise.all(
        currentItems.map(async (item) => {
          try {
            const totp = await getTotp(item.shareId, item.itemId);
            return { ...item, currentTotp: totp };
          } catch {
            return item;
          }
        })
      );
      setItems(updatedItems);
      itemsRef.current = updatedItems;
    } finally {
      setIsRefreshing(false);
    }
  }

  // Handle error states with EmptyView
  if (error === "not_installed") {
    return (
      <List>
        <List.EmptyView
          icon={Icon.XMarkCircle}
          title="Proton Pass CLI Not Installed"
          description="You need to install the Proton Pass CLI to use this extension."
          actions={
            <ActionPanel>
              <Action.OpenInBrowser title="Open Installation Guide" url={PROTON_PASS_CLI_DOCS} icon={Icon.Globe} />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  if (error === "not_authenticated") {
    return (
      <List>
        <List.EmptyView
          icon={Icon.Lock}
          title="Not Logged In"
          description="Run 'pass-cli login' in terminal to authenticate"
          actions={
            <ActionPanel>
              <Action.OpenInBrowser title="View Login Instructions" url={PROTON_PASS_CLI_DOCS} icon={Icon.Globe} />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  async function copyTotp(totp: string, title: string) {
    await Clipboard.copy(totp);
    showToast({ style: Toast.Style.Success, title: "TOTP Copied", message: `${title}: ${totp}` });
  }

  // Color based on remaining time (green > 10s, yellow > 5s, red <= 5s)
  function getTimerColor(): Color {
    if (remainingSeconds > 10) return Color.Green;
    if (remainingSeconds > 5) return Color.Yellow;
    return Color.Red;
  }

  return (
    <List isLoading={isLoading || isRefreshing} searchBarPlaceholder="Search TOTP items...">
      <List.Section title="TOTP Codes" subtitle={isRefreshing ? "Refreshing..." : `Refreshing in ${remainingSeconds}s`}>
        {items.map((item) => (
          <List.Item
            key={`${item.shareId}-${item.itemId}`}
            icon={getItemIcon(item.type)}
            title={item.title}
            subtitle={item.vaultName}
            accessories={[
              {
                tag: {
                  value: item.currentTotp ? formatTotpCode(item.currentTotp) : "---",
                  color: getTimerColor()
                }
              },
              { text: `${remainingSeconds}s`, icon: Icon.Clock }
            ]}
            actions={
              <ActionPanel>
                {item.currentTotp && (
                  <Action
                    title="Copy TOTP Code"
                    icon={Icon.Clipboard}
                    onAction={() => copyTotp(item.currentTotp!, item.title)}
                  />
                )}
                <Action
                  title="Refresh Codes"
                  icon={Icon.ArrowClockwise}
                  shortcut={{ modifiers: ["cmd"], key: "r" }}
                  onAction={refreshTotpCodes}
                />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
      {items.length === 0 && !isLoading && !error && (
        <List.EmptyView
          icon={Icon.Clock}
          title="No TOTP Items"
          description="None of your items have TOTP configured"
        />
      )}
    </List>
  );
}
