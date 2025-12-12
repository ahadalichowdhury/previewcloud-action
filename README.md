# PreviewCloud GitHub Action

Automatically deploy preview environments to PreviewCloud for every pull request.

## 🚀 Quick Start

### 1. Add PreviewCloud Token to GitHub Secrets

Go to your repository settings:
```
Settings → Secrets and variables → Actions → New repository secret
```

Add:
- **Name**: `PREVIEWCLOUD_TOKEN`
- **Value**: Your PreviewCloud API token (from dashboard)

### 2. Create Workflow File

Create `.github/workflows/preview.yml`:

```yaml
name: PreviewCloud Deploy

on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

jobs:
  deploy-preview:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Deploy to PreviewCloud
        uses: previewcloud/action@v1
        with:
          api-token: ${{ secrets.PREVIEWCLOUD_TOKEN }}
```

### 3. Create `preview.yaml` in Repository Root

```yaml
services:
  web:
    dockerfile: ./frontend/Dockerfile
    port: 3000
  
  api:
    dockerfile: ./backend/Dockerfile
    port: 8080

database:
  type: postgres
  migrations: ./backend/migrations
```

### 4. Open a Pull Request

That's it! PreviewCloud will automatically:
- ✅ Build and deploy your preview environment
- ✅ Comment on PR with preview URLs
- ✅ Update on new commits
- ✅ Destroy when PR is closed

---

## 📋 Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `api-token` | PreviewCloud API token | Yes | - |
| `api-url` | PreviewCloud API URL | No | `https://api.previewcloud.cloud` |
| `config-file` | Path to preview.yaml | No | `preview.yaml` |
| `working-directory` | Working directory | No | `.` |
| `secrets` | Secrets to pass (multiline) | No | - |
| `pr-number` | PR number (auto-detected) | No | Auto |
| `action` | Action: deploy, destroy, auto | No | `auto` |
| `comment-on-pr` | Post comment on PR | No | `true` |
| `wait-for-deployment` | Wait for completion | No | `true` |
| `timeout` | Timeout in seconds | No | `600` |

---

## 📤 Outputs

| Output | Description |
|--------|-------------|
| `preview-id` | Unique ID of preview environment |
| `preview-url` | Primary preview URL |
| `preview-urls` | JSON with all service URLs |
| `status` | Deployment status |
| `deployment-time` | Time taken in seconds |

---

## 📚 Usage Examples

### Example 1: Basic Usage

```yaml
name: PreviewCloud Deploy

on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

jobs:
  deploy-preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: previewcloud/action@v1
        with:
          api-token: ${{ secrets.PREVIEWCLOUD_TOKEN }}
```

### Example 2: With Secrets

```yaml
name: PreviewCloud Deploy

on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

jobs:
  deploy-preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Deploy to PreviewCloud
        uses: previewcloud/action@v1
        with:
          api-token: ${{ secrets.PREVIEWCLOUD_TOKEN }}
          secrets: |
            JWT_SECRET=${{ secrets.JWT_SECRET }}
            STRIPE_SECRET_KEY=${{ secrets.STRIPE_SECRET_KEY }}
            AWS_ACCESS_KEY=${{ secrets.AWS_ACCESS_KEY }}
            AWS_SECRET_KEY=${{ secrets.AWS_SECRET_KEY }}
            SENDGRID_API_KEY=${{ secrets.SENDGRID_API_KEY }}
```

### Example 3: Custom Configuration

```yaml
name: PreviewCloud Deploy

on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

jobs:
  deploy-preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Deploy to PreviewCloud
        uses: previewcloud/action@v1
        with:
          api-token: ${{ secrets.PREVIEWCLOUD_TOKEN }}
          config-file: .previewcloud/config.yaml
          working-directory: ./apps/main
          timeout: 900
          comment-on-pr: true
```

### Example 4: Use Outputs

```yaml
name: PreviewCloud Deploy

on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

jobs:
  deploy-preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Deploy to PreviewCloud
        id: preview
        uses: previewcloud/action@v1
        with:
          api-token: ${{ secrets.PREVIEWCLOUD_TOKEN }}
      
      - name: Run E2E Tests
        if: steps.preview.outputs.status == 'success'
        run: |
          export PREVIEW_URL=${{ steps.preview.outputs.preview-url }}
          npm run test:e2e
      
      - name: Notify Slack
        run: |
          echo "Preview deployed: ${{ steps.preview.outputs.preview-url }}"
          echo "Deployment took: ${{ steps.preview.outputs.deployment-time }}s"
```

### Example 5: Manual Deploy Only

```yaml
name: Manual Preview Deploy

on:
  workflow_dispatch:
    inputs:
      pr_number:
        description: 'PR number to deploy'
        required: true

jobs:
  deploy-preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: previewcloud/action@v1
        with:
          api-token: ${{ secrets.PREVIEWCLOUD_TOKEN }}
          pr-number: ${{ github.event.inputs.pr_number }}
          action: deploy
```

### Example 6: Monorepo with Multiple Apps

```yaml
name: PreviewCloud Deploy

on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

jobs:
  deploy-web-app:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Deploy Web App
        uses: previewcloud/action@v1
        with:
          api-token: ${{ secrets.PREVIEWCLOUD_TOKEN }}
          config-file: apps/web/preview.yaml
          working-directory: apps/web
  
  deploy-mobile-api:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Deploy Mobile API
        uses: previewcloud/action@v1
        with:
          api-token: ${{ secrets.PREVIEWCLOUD_TOKEN }}
          config-file: apps/mobile-api/preview.yaml
          working-directory: apps/mobile-api
```

---

## 🔒 Security

### Secrets Management

**Good:**
```yaml
- uses: previewcloud/action@v1
  with:
    api-token: ${{ secrets.PREVIEWCLOUD_TOKEN }}
    secrets: |
      JWT_SECRET=${{ secrets.JWT_SECRET }}
      STRIPE_KEY=${{ secrets.STRIPE_KEY }}
```

**Bad:**
```yaml
- uses: previewcloud/action@v1
  with:
    api-token: ${{ secrets.PREVIEWCLOUD_TOKEN }}
    secrets: |
      JWT_SECRET=hardcoded-secret-here  # ❌ Never do this!
```

### Permissions

The action needs these permissions (automatically granted):
- `contents: read` - To checkout code
- `pull-requests: write` - To comment on PRs (if `comment-on-pr: true`)

To explicitly set:
```yaml
jobs:
  deploy-preview:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      # ...
```

---

## 🎯 How It Works

### On PR Open/Update:
1. Action reads `preview.yaml`
2. Sends deployment request to PreviewCloud
3. PreviewCloud builds Docker images
4. Deploys containers with routing
5. Provisions database
6. Runs migrations
7. Returns preview URLs
8. Action comments on PR

### On PR Close:
1. Action sends destroy request
2. PreviewCloud stops containers
3. Drops database
4. Cleans up resources

---

## 🐛 Troubleshooting

### Action fails with "Config file not found"
- Make sure `preview.yaml` exists in repository root
- Or specify custom path with `config-file` input

### No comment on PR
- Make sure `GITHUB_TOKEN` has `pull-requests: write` permission
- Check if `comment-on-pr` is set to `true`

### Deployment timeout
- Increase `timeout` input (default: 600s)
- Check PreviewCloud dashboard for build logs

### Secrets not working
- Verify secrets are added to GitHub repository
- Check secret names match in workflow and `preview.yaml`
- Use `secrets` input to pass them to PreviewCloud

---

## 📖 Links

- [PreviewCloud Documentation](https://docs.previewcloud.cloud)
- [Configuration Reference](https://docs.previewcloud.cloud/config)
- [Examples Repository](https://github.com/previewcloud/examples)
- [Support](https://previewcloud.cloud/support)

---

## 📄 License

MIT

---

## 🤝 Contributing

Contributions welcome! Please open an issue or PR on [GitHub](https://github.com/previewcloud/action).

---

**Made with ❤️ by PreviewCloud**
