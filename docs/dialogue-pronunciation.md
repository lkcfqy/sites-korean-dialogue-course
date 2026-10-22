# 当前句内的拼读帮助

2026-10-08：在对话页点任意含韩文字块的词形，按需展开“拼读当前词形”。无需跳去单词页。字母/收音拆分按当前词形展示，保留标点外的所有完整韩文音节；NFC规范化支持组合式韩文字母输入。拆分仅解释拼写，不能拿首音/元音/末音列表自动推断实际发音。

原词注释中的助词、词尾与语境提示现在显示在同一弹窗。不可靠链接的词形仍明确提示未可靠链接；没有因新增拼读弹窗就猜出词义或制造词汇覆盖。遮住回忆时不渲染词形和弹窗，保持已有独立证据保护。

实际音变只对五个可核实词形提示：학교（及有限助词）、밥을、같이、좋아요、읽어요。学校的提示只说明学校词干的读音，后接助词的整段仍以音频核对。其他词展示字块并回到合成音频，不假称通用发音转换或自动评估。当前词形、整句的播放仍用原播放器，语体和语调依场景理解。

依据国立国语院 [韩文字块原理](https://www.korean.go.kr/hangeul/principle/001.html)，字块有首辅音、元音及可选收音位置；[한국어기초사전 학교](https://krdict.korean.go.kr/kor/dicSearch/SearchView?ParaWordNo=73276) 给出学校词的读音。连音的 밥을 例参照 [国立国语院规范教学资料](https://www.korean.go.kr/common/download.do%3Bfront%3D2704CF68247FAA4DFEB1F11E1D8A2FB9?c_file_name=fa64499d-d020-44e9-895c-6116a37a58e4_0.pdf&file_path=etcData&o_file_name=%EB%B0%94%EB%A5%B8+%EA%B5%AD%EC%96%B4+%EC%83%9D%ED%99%9C+-+%EA%B5%AD%EC%96%B4%EB%AC%B8%ED%99%94%ED%95%99%EA%B5%90.pdf)。같이 的音变参照 [韩国语教学指导资料](https://www.korean.go.kr/common/download.do?book_seq=294&c_file_name=48c417c6-047f-48f4-88a7-959f28e5e0ad_0.pdf&downGubun=bookDataView&file_path=bookData&o_file_name=%ED%95%9C%EA%B5%AD%EC%96%B4%EC%A7%84%ED%9D%A5-02-17.pdf)。좋아요/읽어요 参照 [世宗韩国语1教师指导书](https://www.korean.go.kr/common/download.do%3Bfront%3DD6C4EE28D2461D56EE66DBDE7F925A44?c_file_name=bf6019e4-c332-4f11-9fff-18cb64b86658_0.pdf&file_path=reportData&o_file_name=%EC%84%B8%EC%A2%85%ED%95%9C%EA%B5%AD%EC%96%B4+1+%EA%B5%90%EC%9B%90%EC%9A%A9+%EC%A7%80%EC%B9%A8%EC%84%9C.pdf)。这些教学提示为中文改写，不是来源全文引用。

回归核对双收音、无收音、组合式字母、标点及不应扩大匹配的其他活用。浏览器行为另记入浏览器验证记录；本文件不预写实测成功。没有独立母语教师发音审校，合成语音也不代表学习者发音达标。

## 本轮实际浏览器证据

390×844视口中，点 `교실이에요?` 并展开提示，实际显示 교/실/이/에/요 的字母，收音 ㄹ、开头 ㅇ 的说明，以及本词形 이다/句末语尾提示。点击“听这个词形”后真实合成请求成功，播放器显示“播放完成”。发现展开长提示时旧固定高度使弹窗上界越出屏幕，改用 Radix 可用空间并复测：top=446、bottom=827.57，全部在844高视口内，长内容内部可滚动。截图为 `screenshots/dialogue-pronunciation-mobile.png`。这些验证只覆盖当前操作及局部音变规则，未评估学习者发音。
