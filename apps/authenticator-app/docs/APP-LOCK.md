# 应用锁设计说明与注意事项

> 适用范围：`apps/authenticator-app`（authenticator.autional.com / .cn）
> 最近更新：2026-11-14（提交 `d8caba5` 之后）

## 1. 一句话结论

本地保险库的机密性由 **设备密钥（deviceKey）** 承担；PIN 与生物识别都只是**解锁 deviceKey 的方式**，不是两把独立的锁。

## 2. 密钥层级

```
PIN (6 位)  ──PBKDF2-HMAC-SHA256 600k──┐
                                        ├─→ 解开 deviceKeyWrap ─┐
WebAuthn PRF 输出 (32B) ──PBKDF2×1──────┘                       │
                                                                ├─→ deviceKey (AES-256-GCM)
                                                                │        │
                                        deviceKeyWrapBio ───────┘        └─→ 加密 accounts JSON
```

要点：

- 两个包裹**包的是同一把 deviceKey**，任选其一即可解 → **有效强度 = min(PIN, PRF)**。弱 PIN 会把生物识别的收益一起废掉。
- `iterations: 1`（PRF 路径）是**正确**的：PRF 输出本身是 32 字节高熵钥材，拉伸无意义。
- 本地 KDF 迭代次数（600k）与备份信封的 `BACKUP_KDF_ITERATIONS` 同口径，但两者独立演进。

## 3. PIN 策略

| 项 | 取值 | 说明 |
|---|---|---|
| 长度 | **固定 6 位** | 开发期决策；不再兼容 4/5/7/8 位 |
| 存储 | `pinKdfIterations`（600_000）、`pinLength`（6） | 随载荷保存，便于日后升级 |
| 校验 | `PIN_PATTERN = /^\d{6}$/` | 新建/修改走此校验；解锁读取路径不校验长度 |
| 改 PIN | 三步：当前 PIN → 新 PIN → 确认 | 必须先验旧 PIN（`storage.verifyPin`）；新 PIN 不得与当前相同 |
| 禁用 | **不支持** | 冷启动硬强制设锁，禁用后下次打开又被逼设回，逻辑矛盾 |

强度提示：6 位 PIN ≈ 19.9 bit；600k 迭代只把成本抬高约 2.6 bit。**真正的防线是 PIN 位数，不是迭代次数**（4 位→6 位 = 100 倍）。

## 4. 自动锁定

| 规则 | 值 | 实现 |
|---|---|---|
| 切后台宽限 | **30 秒** | `AUTO_LOCK_AFTER_MS`，`visibilitychange` 记时间戳，回前台用 `Date.now()` 差值判定 |
| 绝对上限 | **12 小时** | `ABSOLUTE_UNLOCK_MAX_MS`（NIST AAL2 为 ≤24h，取 AAL3 的 12h 更保守） |
| 锁定时动作 | 清内存 deviceKey + 备份会话钥 + `accounts` | `lockVault()` → `clearSessionKeys()` + 一次 `setState` |
| 生物识别期间 | 抑制自动锁定 | `setCeremonyActive(true)`，防系统弹窗的 visibility 抖动导致自锁循环 |
| bfcache 恢复 | 重新判定 | `pageshow(persisted=true)`；若「界面已解锁但无内存钥」→ 直接锁 |

注意：`main.tsx` 里**不要**再挂 `pagehide → clearSessionKeys`（切后台/进 bfcache 也触发，会造成「界面已解锁但密钥已清」，此时落盘必失败）。密钥只在锁定路径清理。

### 4.1 失败尝试节流

| 项 | 取值 |
|---|---|
| 阈值 | 连续失败 5 次 → 冷却 30 秒 |
| 解锁屏 | 冷却中键盘禁用并显示倒计时；成功一次即清零；生物识别不受影响 |
| 设置页改 PIN | `verifyPin` 同样受冷却约束，弹层区分「冷却中（剩 N 秒）」与「PIN 不正确」 |
| 局限 | 计数存 localStorage，清站点数据/换浏览器即清零 —— 它挡的是「借来手机慢慢试」，不是离线爆破（离线爆破由 PIN 熵 + KDF 承担） |

## 5. 生物识别（WebAuthn PRF）

- **必须以 PIN 为前提**：`setBiometricProtection()` 在无 PIN（明文 deviceKey）时会抛 `PIN_REQUIRED_FOR_BIOMETRIC` —— 否则只是「多挂一把锁，钥匙仍在门上」。
- 解锁屏**生物识别优先**：能力就绪即自动尝试一次；失败/取消/不支持 → 落回 PIN，不循环弹窗。
- PIN 是唯一恢复通道：凭据丢失（换机、清数据、重录生物特征）只能靠 PIN。因此设置页与设锁页都要求「先有 PIN，才能开生物识别」。
- 平台差异：iOS 16/17 对 `navigator.credentials.get()` 有「每页面一次免手势」限制，自动弹可能失败；iOS 17.4+ 已放宽。失败会落回 PIN，不会卡住页面。
- passkey 会随 iCloud 钥匙串 / Google 密码管理器同步 → 信任根是 **Apple/Google 账号**，不是单台设备。

## 6. 输入方式：自绘数字键盘

- 解锁屏 / 设锁页 / 设置页改 PIN 全部使用 `PinKeypad`，**不出现系统键盘** —— 这也是密码管理器「保存密码」误判的根治手段（此前只能靠掩码文本 + `autocomplete=off` 缓解）。
- 6 位输满**自动提交**，不设确认键；设锁与改 PIN 为两步（输入→确认）。
- 交互：按压缩放、圆点填充、错误抖动 420ms、Android 震动 8ms（iOS 无 vibrate 静默降级）、长按删除键清空、`prefers-reduced-motion` 关闭动画。
- 桌面保留物理键盘（数字/退格/回车），`Ctrl/Cmd/Alt+数字` 与焦点在可交互元素时的回车一律放行。
- a11y：数字键是真实 `<button>` + `aria-label`，圆点区 `role="status"`，另有 `aria-live` 播报「已输入 N 位」。
- 长按不会选中数字：键盘容器 `select-none` + `user-select/touch-callout: none` + `touch-action: manipulation`，并在容器级拦截 `contextmenu`（删除键的长按清空逻辑不受影响）。

## 7. 开发期临时决策

| # | 事项 | 状态 |
|---|---|---|
| 1 | 旧长度库处理 | ✅ 已闭环（`d8caba5`）：解锁键盘按库中 `pinLength` 放开 4-8 位，解锁成功后静默补写，**不再清空数据** |
| 2 | 清空保险库的确认 | ✅ 已闭环：改为「忘记 PIN？」入口 + 弹层，危险按钮需点两次（5 秒无操作自动复位） |
| 3 | `verifyPin` 防爆破 | ✅ 已闭环：接入 5 次/30s 冷却 |
| 4 | PIN 长度 | ⏳ 固定 6 位；若放宽需同步 `PIN_PATTERN`、键盘 `minLength/maxLength`、`pinLength` 迁移 |
| 5 | 无 PIN 时的设置页入口 | ⏳ `hasPin === false` 时设置页不显示「设 PIN」按钮（首设只在冷启动闸门）；若允许在设置页补设，需给弹层加「跳过 verify」分支 |

## 8. 已知限制与坑

1. **提交说明会进 `.com` 的前端 bundle**：Vercel 构建会内嵌 `VITE_VERCEL_GIT_COMMIT_MESSAGE`。做线上文案取证时，`.com` 的命中数会包含提交说明文本；**验收请用键名（如 `"settings.pinHintNew"`）而不是文案**。
2. **`.cn` 发布有 20–40 秒半部署窗口**：mf01 先清旧 assets 再拷新产物，窗口内刷新可能白屏。根治需改成「先拷后切/原子目录切换」（属 `shared/ci` 侧的活）。
3. **PWA 缓存**：老用户可能先拿到旧 SW 缓存的 bundle，刷新一两次才切到新版；排查线上问题时先清 SW + caches。
4. **前端锁不是安全边界**：`lockVault()` 只清内存，localStorage 密文仍在；真正的机密性来自 PIN/PRF 不在内存里。
5. **`pagehide` 清理密钥是坑**（见 §4）。任何新增的「页面离开时清钥」逻辑，都必须同时把 `isUnlocked` 置 false。
6. **iOS/Android 行为差异**：某些 OEM 的后台冻结会延迟 `visibilitychange`，表现为「该锁没锁」（漏判），不会误锁。
7. **尝试计数是客户端状态**：存在 localStorage，可被清除；不要把它当防爆破手段。
8. **旧长度库首次解锁仍有一次性成本**：`pinLength` 未知（更早的库）时会显示确认键，手敲 4 位就点确认会计一次失败；设置页会提示「当前 PIN 不是 6 位，建议重设」。

## 9. 线上验收指纹（本主题）

| 版本 | 可用指纹 |
|---|---|
| 应用锁（30s/12h）+ 强制设锁 | `先给应用加把锁`、`立即锁定` |
| 自绘数字键盘 | `数字键盘`、`长按删除键可清空`、CSS 里的 `pin-shake` |
| PIN 固定 6 位 | `当前 PIN 不是 6 位`（该键已删，仅旧版有）、`输入 6 位数字` |
| 设置页弹层三步 | `修改应用锁 PIN`、`当前 PIN 不正确`、`新 PIN 不能与当前 PIN 相同` |
| 旧库重置页 | `本地保险库需要重置`、`清空并重设`（仅开发期版本） |
| 旧库迁移 + 忘记 PIN + 冷却 | `再点一次确认`、`忘记 PIN？`、`尝试次数过多` |

## 10. 测试基线

- `pnpm --filter @autional/authenticator-app test` → 63 files / 574 tests（截至 `d8caba5`）
- 覆盖要点：弱 PIN 拒绝、`pinKdfIterations` 写入、`verifyPin` 三态、自动提交一次、无确认键、弹层三步（错误的当前 PIN / 与当前相同 / 两次不一致 / 成功）、自动锁定（30s / 12h / ceremony 抑制 / bfcache 无钥）、强制设锁闸门、旧库重置闸门、旧长度解锁 4 例、忘记 PIN 二次确认、解锁冷却 3 例、`verifyPin` 冷却
