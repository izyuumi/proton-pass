import { List, ActionPanel, Action, Icon, showToast, Toast, Clipboard, getPreferenceValues } from "@raycast/api";
import { useState, useEffect, useCallback } from "react";
import { generatePassword, passwordScore } from "./lib/pass-cli";
import { Preferences, PasswordScore, PassCliError, PassCliErrorType } from "./lib/types";
import { getPasswordStrengthLabel, getPasswordStrengthIcon, maskPassword } from "./lib/utils";

const PROTON_PASS_CLI_DOCS = "https://protonpass.github.io/pass-cli/";

export default function Command() {
  const preferences = getPreferenceValues<Preferences>();
  const [password, setPassword] = useState<string>("");
  const [score, setScore] = useState<PasswordScore | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<PassCliErrorType | null>(null);

  const generate = useCallback(
    async (type?: "random" | "passphrase") => {
      setIsLoading(true);
      try {
        const passwordType = type || (preferences.defaultPasswordType as "random" | "passphrase") || "random";
        const options = {
          type: passwordType as "random" | "passphrase",
          length: passwordType === "random" ? parseInt(preferences.defaultPasswordLength || "20") : undefined,
          words: passwordType === "passphrase" ? 4 : undefined,
        };

        const newPassword = await generatePassword(options);
        setPassword(newPassword);

        const newScore = await passwordScore(newPassword);
        setScore(newScore);
        setError(null);
      } catch (e: unknown) {
        if (e instanceof PassCliError) {
          setError(e.type);
        } else {
          setError("unknown");
        }
      } finally {
        setIsLoading(false);
      }
    },
    [preferences],
  );

  useEffect(() => {
    generate();
  }, [generate]);

  if (error === "not_installed") {
    return (
      <List>
        <List.EmptyView
          icon={Icon.XMarkCircle}
          title="Proton Pass CLI Not Installed"
          description="You need to install the Proton Pass CLI to use this extension. Click below to learn how to install it."
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
          description="You need to login to Proton Pass to generate passwords. Use the 'Login to Proton Pass' command first."
          actions={
            <ActionPanel>
              <Action.OpenInBrowser title="View CLI Documentation" url={PROTON_PASS_CLI_DOCS} icon={Icon.Globe} />
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
              <Action title="Retry" icon={Icon.ArrowClockwise} onAction={() => generate()} />
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
              <Action title="Retry" icon={Icon.ArrowClockwise} onAction={() => generate()} />
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
              <Action title="Retry" icon={Icon.ArrowClockwise} onAction={() => generate()} />
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
          title="Failed to Generate Password"
          description="An error occurred while generating your password"
          actions={
            <ActionPanel>
              <Action title="Retry" icon={Icon.ArrowClockwise} onAction={() => generate()} />
              <Action.OpenInBrowser title="View Documentation" url={PROTON_PASS_CLI_DOCS} icon={Icon.Globe} />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  async function copyPassword() {
    await Clipboard.copy(password, { transient: preferences.copyPasswordTransient ?? true });
    showToast({ style: Toast.Style.Success, title: "Password Copied" });
  }

  return (
    <List isLoading={isLoading}>
      {password && (
        <>
          <List.Item
            icon={Icon.Key}
            title="Generated Password"
            subtitle={showPassword ? password : maskPassword(password)}
            accessories={
              score
                ? [
                    {
                      icon: getPasswordStrengthIcon(score.passwordScore),
                      text: getPasswordStrengthLabel(score.passwordScore),
                      tooltip: score.penalties ? score.penalties.join(", ") : undefined,
                    },
                  ]
                : []
            }
            actions={
              <ActionPanel>
                <Action title="Copy Password" icon={Icon.Clipboard} onAction={copyPassword} />
                <Action
                  title={showPassword ? "Hide Password" : "Show Password"}
                  icon={showPassword ? Icon.EyeDisabled : Icon.Eye}
                  onAction={() => setShowPassword(!showPassword)}
                  shortcut={{ modifiers: ["cmd"], key: "h" }}
                />
                <ActionPanel.Section title="Generate New">
                  <Action
                    title="Generate Random Password"
                    icon={Icon.Shuffle}
                    onAction={() => generate("random")}
                    shortcut={{ modifiers: ["cmd"], key: "r" }}
                  />
                  <Action
                    title="Generate Passphrase"
                    icon={Icon.Text}
                    onAction={() => generate("passphrase")}
                    shortcut={{ modifiers: ["cmd"], key: "p" }}
                  />
                </ActionPanel.Section>
              </ActionPanel>
            }
          />
          {score && (
            <List.Item
              icon={getPasswordStrengthIcon(score.passwordScore)}
              title="Password Strength"
              subtitle={getPasswordStrengthLabel(score.passwordScore)}
              accessories={[
                { text: `${Math.round(score.numericScore)}` },
                ...(score.penalties && score.penalties.length > 0
                  ? [{ text: `${score.penalties.length} ${score.penalties.length === 1 ? "penalty" : "penalties"}` }]
                  : []),
              ]}
            />
          )}
        </>
      )}
    </List>
  );
}
