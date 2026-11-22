## 原创电台录音

以下乐曲与录音均为本项目原创，以 CC0 1.0 提供。旋律、低音和打击声全部来自仓库内的谱表与振荡器，没有使用第三方歌曲、录音、采样包或音效。

| 文件 | 曲目 | 原始来源 | 许可 |
| --- | --- | --- | --- |
| `public/audio/radio/bridge-wind.mp3` | 解放桥上的风 | [原创谱表与合成器](../scripts/render-radio.py) · bridge-wind | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/radio/boat-lights.mp3` | 船灯靠岸 | [原创谱表与合成器](../scripts/render-radio.py) · boat-lights | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/radio/scooter-bell.mp3` | 电驴铃 | [原创谱表与合成器](../scripts/render-radio.py) · scooter-bell | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/radio/morning-stall.mp3` | 早市开摊 | [原创谱表与合成器](../scripts/render-radio.py) · morning-stall | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |

用 `python3 scripts/render-radio.py` 重新生成 MP3；构建不依赖 ffmpeg。`npm run check:audio` 对照仓库音频、许可表和电台曲单。
