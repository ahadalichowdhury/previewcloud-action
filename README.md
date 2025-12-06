# PreviewCloud GitHub Action

Create, update, and destroy fully isolated **preview environments** for your pull requests — automatically.  
This GitHub Action integrates with the **PreviewCloud** platform to give every PR its own live environment where frontend, backend, and microservices deploy instantly.

Perfect for:
- Feature testing  
- QA validation  
- Stakeholder demos  
- Automatic ephemeral environments  
- Multi-service previews

---

## 🚀 Features

- 🔄 **Automatic environment creation** on every PR  
- 🛠️ **Update previews** when new commits are pushed  
- ❌ **Destroy environments** when PR is closed or manually triggered  
- 📄 Uses your own `preview.yaml` configuration  
- 🌐 Returns deployed URLs for all services  
- 📦 Supports monorepo + multi-service previews  
- ⚡ Fast, curl-based lightweight action (no Node/Docker dependency)

---

## 📌 Usage

```yaml
      - name: Create PreviewCloud environment
        uses: ahadalichowdhury/previewcloud-action@v1.0.0
        with:
          api_key: ${{ secrets.PREVIEWCLOUD_API_KEY }}
          pr_number: ${{ github.event.pull_request.number }}
          branch: ${{ github.head_ref }}
          commit_sha: ${{ github.sha }}
          repository: ${{ github.repository }}
