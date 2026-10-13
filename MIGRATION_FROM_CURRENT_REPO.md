# Chuyển repo hiện tại sang scaffold React Native mới

Repo hiện tại của bạn đang có Vite scaffold. Hãy commit/push trước khi thay đổi.

## 1. Tạo checkpoint

```powershell
git add .
git commit -m "chore: checkpoint before mobile scaffold v2"
git push
```

## 2. Xóa các file Vite cũ

Không xóa `.git`.

Có thể xóa các thành phần web cũ như:

```text
public/
src/
index.html
vite.config.ts
vite-env.d.ts
tsconfig.app.json
tsconfig.node.json
node_modules/
package-lock.json
```

Sau đó copy toàn bộ nội dung scaffold này vào root repo.

## 3. Cài dependency

```powershell
npm install
npm run typecheck
npm run lint
npm test
npx expo start
```

## 4. Commit scaffold mới

```powershell
git add .
git commit -m "chore: initialize React Native feature-based architecture"
git push
```

Không copy `.git` từ scaffold; sử dụng `.git` hiện có của repo.
