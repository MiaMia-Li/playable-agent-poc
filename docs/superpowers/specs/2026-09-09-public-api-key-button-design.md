# Public API Key Button Design

## Goal

Allow users in public-access mode to reopen the existing OpenAI API Key dialog and replace the currently configured key.

## Design

In the workspace header's public-access branch, replace the passive `Badge` labeled “公开体验 · 自备 API Key” with a secondary small `Button` using the same label. Clicking it calls the existing `requireApiKey` handler, which opens the existing `ApiKeyDialog`.

Submitting the dialog continues to use `PUT /api/session/openai-key`; the existing endpoint validates the key and overwrites the encrypted HttpOnly session cookie. No new API route or key storage mechanism is introduced.

## Error Handling

The existing dialog keeps responsibility for validation and displays its current allowlisted API-key errors. Closing the dialog leaves the currently configured key unchanged.

## Testing

Add a component test that renders `PlayableWorkspace` in public-access mode, verifies the button is present, clicks it, and confirms that the API Key dialog opens.
