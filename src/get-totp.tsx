import { List, ActionPanel, Action, Icon, showToast, Toast, Clipboard, Color } from "@raycast/api";
import { useState, useEffect, useRef } from "react";
import { listItems, getTotp, checkAuth } from "./lib/pass-cli";
import { Item, PassCliError, PassCliErrorType } from "./lib/types";
import { getItemIcon, getTotpRemainingSeconds, formatTotpCode } from "./lib/utils";
import { getCachedItems, setCachedItems } from "./lib/cache";

const PROTON_PASS_CLI_DOCS = "https://protonpass.github.io/pass-cli/";

interface TotpItem extends Item {
  currentTotp?: string;
}

export default function Command() {
  const [items, setItems] = useState<TotpItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(getTotpRemainingSeconds());
  const [error, setError] = useState<PassCliErrorType | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | undefined>(undefined);
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
    setError(null);

    const cachedItems = await getCachedItems();
    if (cachedItems) {
      const cachedTotpItems = cachedItems.filter((item) => item.hasTotp);
      if (cachedTotpItems.length > 0) {
        const itemsWithPlaceholder = cachedTotpItems.map((item) => ({
          ...item,
          currentTotp: undefined,
        }));
        setItems(itemsWithPlaceholder);
        itemsRef.current = itemsWithPlaceholder;
        setIsLoading(false);

        const itemsWithTotp = await Promise.all(
          cachedTotpItems.map(async (item) => {
            try {
              const totp = await getTotp(item.shareId, item.itemId);
              return { ...item, currentTotp: totp };
            } catch {
              return { ...item, currentTotp: undefined };
            }
          }),
        );
        setItems(itemsWithTotp);
        itemsRef.current = itemsWithTotp;
      }
    }

    try {
      const isAuth = await checkAuth();
      if (!isAuth) {
        setError("not_authenticated");
        setIsLoading(false);
        return;
      }

      const freshItems = await listItems();
      await setCachedItems(freshItems);

      const totpItems = freshItems.filter((item) => item.hasTotp);
      const itemsWithTotp = await Promise.all(
        totpItems.map(async (item) => {
          try {
            const totp = await getTotp(item.shareId, item.itemId);
            return { ...item, currentTotp: totp };
          } catch {
            return { ...item, currentTotp: undefined };
          }
        }),
      );

      setItems(itemsWithTotp);
      itemsRef.current = itemsWithTotp;
    } catch (e: unknown) {
      if (!cachedItems) {
        if (e instanceof PassCliError) {
          setError(e.type);
        } else {
          setError("unknown");
        }
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
        }),
      );
      setItems(updatedItems);
      itemsRef.current = updatedItems;
    } finally {
      setIsRefreshing(false);
    }
  }

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

  if (error === "keyring_error") {
    return (
      <List>
        <List.EmptyView
          icon={Icon.Key}
          title="Keyring Access Failed"
          description="pass-cli could not access secure key storage. Try: pass-cli logout --force, then set PROTON_PASS_KEY_PROVIDER=fs and login again."
          actions={
            <ActionPanel>
              <Action title="Retry" icon={Icon.ArrowClockwise} onAction={loadTotpItems} />
              <Action.OpenInBrowser title="View Documentation" url={PROTON_PASS_CLI_DOCS} icon={Icon.Globe} />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  if (error === "network_error") {
    return (
      <List>
        <List.EmptyView
          icon={Icon.Wifi}
          title="Network Error"
          description="Check your internet connection and try again"
          actions={
            <ActionPanel>
              <Action title="Retry" icon={Icon.ArrowClockwise} onAction={loadTotpItems} />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  if (error === "timeout") {
    return (
      <List>
        <List.EmptyView
          icon={Icon.Clock}
          title="Request Timed Out"
          description="pass-cli took too long to respond. Please try again."
          actions={
            <ActionPanel>
              <Action title="Retry" icon={Icon.ArrowClockwise} onAction={loadTotpItems} />
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
          title="Failed to Load TOTP Items"
          description="An error occurred while loading your TOTP items"
          actions={
            <ActionPanel>
              <Action title="Retry" icon={Icon.ArrowClockwise} onAction={loadTotpItems} />
              <Action.OpenInBrowser title="View Documentation" url={PROTON_PASS_CLI_DOCS} icon={Icon.Globe} />
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
                  color: getTimerColor(),
                },
              },
              { text: `${remainingSeconds}s`, icon: Icon.Clock },
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
        <List.EmptyView icon={Icon.Clock} title="No TOTP Items" description="None of your items have TOTP configured" />
      )}
    </List>
  );
}
