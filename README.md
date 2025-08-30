# 今天吃啥 · 2GIS 转盘选饭店

一个纯前端网页：输入地址或使用定位，选择半径（米），自动在地图上圈定范围，并用一个“随机转盘”来从附近饭店中随机挑选一家，显示其地址、评分等信息。转盘最多展示 12 家饭店（随机抽样）。

- 地图底图：2GIS Maps API（Leaflet 封装）。
- 餐厅数据：
  - 默认“演示模式”生成模拟数据（无需任何 Key）。
  - 如需真实饭店数据，请接入 2GIS Directory（Catalog）API，需要 API Key。

## 使用方式

- 直接用浏览器打开 `index.html`（建议用本地静态服务器，如 VSCode Live Server / `python -m http.server`）。
- 页面顶部填写地址或点击“使用定位”。
- 选择半径后点击“搜索饭店”。
- 点击“开始转”，指针所指即为随机结果；下方会显示详情。
- 没有 API Key 时，可勾选“使用示例数据”。

## 文件结构

- `index.html`：页面结构，加载 2GIS Maps API 和业务脚本。
- `assets/style.css`：样式。
- `assets/app.js`：地图、搜索、转盘的主要逻辑。

## 2GIS Maps API

页面已引入 2GIS Maps API Loader：

```html
<script src="https://maps.api.2gis.ru/2.0/loader.js?pkg=full"></script>
```

若 `.ru` 域在你所在地区不可用，可尝试将域名替换为 `.com` 版本。

## 接入 2GIS Directory API（真实饭店数据）

前端静态页面需要跨域调用，推荐使用 JSONP（2GIS 提供）。在 `assets/app.js` 中有占位函数：

```js
function loadRestaurants2GIS(center, radiusMeters, apiKey) {
  // TODO: 在这里用 2GIS Catalog API + JSONP 拉取附近餐厅
}
```

你可以：

- 在浏览器控制台设置 `window.TWO_GIS_API_KEY = '你的Key'`，或直接在 `assets/app.js` 顶部填写。
- 使用 2GIS Maps API 暴露的 JSONP 工具（例如 `DG.ajax.jsonp(...)`）发起请求，这样无需自建服务代理。
- 将返回结果映射为下列字段（本项目使用的最小字段集）：
  - `id`：字符串
  - `name`：名称
  - `lat` / `lng`：坐标（WGS84）
  - `address`：地址字符串
  - `rating`：评分（可选）
  - `url`：详情页链接（可选）
  - `phones`：电话数组（可选）

请参考 2GIS 官方文档，选择“按点 + 半径”附近检索的接口与参数（餐饮类目/关键字等）。

> 说明：为避免误导，这里未硬编码 API 路径与参数名；不同版本/地区的接口和字段可能差异，请以官方文档为准。

## 地理编码（地址→坐标）

默认使用 OpenStreetMap Nominatim 做演示地理编码（无需 Key）。你也可以改为 2GIS 的地理编码服务：在 `geocodeAddress` 中替换为你的实现。

## 在哪里配置 API Key？

- 文件：`assets/app.js`
- 方式一：直接编辑文件顶部的 `window.TWO_GIS_API_KEY = ''`。
- 方式二：在浏览器控制台执行 `window.TWO_GIS_API_KEY = '你的Key'` 后再点击“搜索饭店”。

## 常见问题

- 看不到地图？
  - 检查 2GIS Loader 是否可访问，必要时切换域名为 `.com`。
- 搜不到饭店？
  - 未配置 2GIS API Key 时，页面会回退到“演示数据”。启用“使用示例数据”复选框可以强制演示模式。
- 转盘不转？
  - 需要先“搜索饭店”，加载到结果之后，转盘按钮才会启用。

## 开发备注

- 该项目不包含构建流程，纯静态资源即可运行。
- 若要自定义 UI/交互，可直接修改 `assets/style.css` 与 `assets/app.js`。
