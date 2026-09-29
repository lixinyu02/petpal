# 微表演扩展 Issues

- Date: 2026-09-30
- Complexity: L2
- Related design: 2026-09-30-petpal-microacting-design.md
- Current status: issue-41 done

## issue-41

- ID: issue-41
- 标题: 新表情、单次动作和安静陪伴微表演
- 范围: 语义/控制器、GL/DOM映射、测试、浏览器验收、网页发布
- 依赖: issue-40 done
- 验收标准: 五种新表情和六种新动作可辨识；idle微表演低频且可取消；口型、已有互动和数据隔离保持；手机与降级可用
- 状态: done
- 验证方式: 控制器87项、合并185项回归、TypeScript、隔离构建通过；Chrome手机/桌面、新表情与动作、待机中断、休息、DOM降级、低动态及公网触摸通过。公网资源哈希、六项匿名门禁、既有数据保留通过。详见 ../microacting-acceptance.md。
- commit: 本 issue 的 feat(issue-41) 提交
