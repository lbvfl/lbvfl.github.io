(function () {
  "use strict";

  var timer = setInterval(function () {
    if (typeof Lampa !== "undefined") {
      clearInterval(timer);

      Lampa.Utils.putScriptAsync(
        [

          "http://wtch.ch/m", //Онлайн без преміум
          "http://bwa.ad/rc", // Онлайн BWA
          "https://lampame.github.io/main/bo.js", // Бандера Онлайн


          "http://192.168.1.11:9120/online.js",
          "https://lbvfl.github.io/radio.js",
         // "https://вашепосилання",
         // "https://вашепосилання",

         // "https://icantrytodo.github.io/lampa/torrent_styles_v2.js", //стиль торентів може конфліктувати з іншими стилями
         // "https://darkestclouds.github.io/plugins/easytorrent/easytorrent.min.js", //рекомендація торрентів

          
          "https://ko31k.github.io/LMP/plugins/Parsers.js",    // Каталог парсерів
          "https://ko31k.github.io/LMP/plugins/interface+.js", // Комплексне покращення інтерфейсу: панелі, мітки, теми, керування кнопками
          "https://ko31k.github.io/LMP/plugins/buttons+.js",   // Редактор кнопок в картці фільму/серіалу
          "https://ko31k.github.io/LMP/plugins/cardify+.js",   // Широкий інтефейс для картки. Чистіша картка, фонові трейлери або слайдшоу
          "https://apxubatop.github.io/lmpPlugs/tvbutton.js",  // Налаштування поведінки першої кнопки
          "https://ko31k.github.io/LMP/plugins/menueditor.js"  // Налаштування меню



          
        ],
        function () {},
      );
    }
  }, 200);
})();
