# Web Search Extension

Registers a `web_search` tool that searches the web using the [Google Custom Search JSON API](https://developers.google.com/custom-search/v1/overview). Returns the top 10 results with title, URL, and snippet.

Free tier: 100 queries/day.

## Configuration

Requires a Google API key and Custom Search Engine ID. These can be provided via environment variables or settings.

### Environment Variables

```sh
export GOOGLE_API_KEY="..."
export GOOGLE_CSE_ID="..."
```

### Settings File

`web-search.settings.json` (3-tier loading):

| Tier | Path |
|------|------|
| Global | `~/<agent-dir>/web-search.settings.json` |
| Project | `<repo-root>/.agents/web-search.settings.json` |
| Local | `<repo-root>/.agents/web-search.settings.local.json` |

```json
{
  "apiKey": "...",
  "cseId": "..."
}
```

Environment variables take precedence over settings files.

## Behavior

- If credentials are missing, the tool returns a configuration error message and a startup widget shows which keys are missing
- Results are formatted as a numbered list with title, link, and snippet
