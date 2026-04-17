---
pageType: home

hero:
  name: NSIO
  text: 站点—客户端对称的覆盖网络生态
  tagline: NSD · NSGW · NSN · NSC · 12 个 Rust crate 的零信任接入平台
  actions:
    - theme: brand
      text: 开始阅读
      link: /01-overview/
    - theme: alt
      text: GitHub
      link: https://github.com/nsiod/docs

features:
  - title: 四组件架构
    details: NSD 下发配置、NSGW 中继 WireGuard/WSS 隧道、NSN 承载站点数据面、NSC 提供用户侧虚 IP+DNS。
    icon: 🏗️
    link: /01-overview/
  - title: 控制面
    details: SSE 推送、Noise 认证、多 Realm 与 HA。配置分发与策略合并不承载业务流量。
    icon: 🧠
    link: /02-control-plane/
  - title: 数据面
    details: WireGuard 优先、WSS/Noise/QUIC 回退。支持多 NSGW 并发与 fallback。
    icon: 🔗
    link: /03-data-plane/
  - title: 网络栈
    details: TUN 与 UserSpace 两种通路，smoltcp + gotatun 解耦内核依赖。
    icon: 🧩
    link: /04-network-stack/
  - title: Proxy / ACL
    details: HTTP Host / SNI peek + ACL 匹配，统一路由到代理或本地 netstack。
    icon: 🛡️
    link: /05-proxy-acl/
  - title: 端到端视角
    details: NSC、NSN 端到端生命周期、观测性、功能差距与演进路线。
    icon: 🧭
    link: /10-nsn-nsc-critique/
---
