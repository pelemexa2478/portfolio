<?php include 'header.php'; ?>
<body>
<link rel="stylesheet" href="style.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/fancybox/3.5.7/jquery.fancybox.min.css" />
<script src="https://code.jquery.com/jquery-3.4.1.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/fancybox/3.5.7/jquery.fancybox.min.js"></script>
<script>
$(document).ready(function() {

    function updateActiveNav() {
        var scrollPosition = $(window).scrollTop() + 150;
        $('.nav-link').removeClass('active');
        var sections = ['#portfolio', '#contact'];
        var activeSection = null;
        
        sections.forEach(function(sectionId) {
            var section = $(sectionId);
            if (section.length) {
                var sectionTop = section.offset().top;
                var sectionBottom = sectionTop + section.outerHeight();
                
                if (scrollPosition >= sectionTop && scrollPosition <= sectionBottom) {
                    activeSection = sectionId;
                }
            }
        });
        
        if (activeSection) {
            $('.nav-link[href="' + activeSection + '"]').addClass('active');
        }
    }

    $(window).on('scroll', function() {
        function isElementInViewport(el) {
            var rect = el[0].getBoundingClientRect();
            return (
                rect.top <= (window.innerHeight || document.documentElement.clientHeight) * 0.8
            );
        }

        $('.skills-title, .icon-block .tooltip, .contact-form, .form-group').each(function() {
            if (isElementInViewport($(this)) && !$(this).hasClass('animated')) {
                $(this).addClass('in-view animated');
            }
        });

        updateActiveNav();
    });

    $('.nav-link').click(function(e) {
        e.preventDefault();
        var targetId = $(this).attr('href');
        var targetSection = $(targetId);
        
        if (targetSection.length) {
            var targetOffset = targetSection.offset().top - 80;
            $('html, body').stop(true, false);
            $('html, body').animate({
                scrollTop: targetOffset
            }, {
                duration: 500,
                easing: 'swing',
                queue: false,
                complete: function() {
                    targetSection.find('.animated').each(function() {
                        $(this).addClass('in-view');
                    });
                    updateActiveNav();
                }
            });
        }
        return false;
    });

    $(window).trigger('scroll');

    $('#contact-form').on('submit', function(e) {
        e.preventDefault();
        
        var $form = $(this);
        var $submitBtn = $('#submit-btn');
        var $messageDiv = $('#form-message');
        var originalText = $submitBtn.text();
        
        $submitBtn.prop('disabled', true).text('Отправка...');
        $messageDiv.hide().removeClass('success error');

        $.ajax({
            url: 'send.php',
            type: 'POST',
            data: $form.serialize(),
            dataType: 'json',
            success: function(response) {
                if (response.success) {
                    $messageDiv.addClass('success')
                        .text(response.message)
                        .fadeIn();
                    $form[0].reset();
                } else {
                    $messageDiv.addClass('error')
                        .text(response.message || 'Произошла ошибка при отправке')
                        .fadeIn();
                }
            },
            error: function(xhr, status, error) {
                var errorMessage = 'Произошла ошибка при отправке сообщения. Попробуйте позже.';
                if (xhr.responseJSON && xhr.responseJSON.message) {
                    errorMessage = xhr.responseJSON.message;
                }
                $messageDiv.addClass('error')
                    .text(errorMessage)
                    .fadeIn();
            },
            complete: function() {
                $submitBtn.prop('disabled', false).text(originalText);
            }
        });
    });
});
</script>
</body>
<main>
    <section class="intro">
        <p style="font-size: 20px;">👋🏻 ПРИВЕТСТВУЮ, Я</p>
        <h2>Роман</h2>
        <p>Опытный веб-разработчик, увлеченный созданием интерактивных интернет-магазинов, сайтов, страниц-визток.</p>
        <p>Я обладаю глубокими познаниями в области фронт-энд и бэк-энд разработки, а также опытом работы с различными языками программирования, фреймворками и CMS. Я не только умею писать код, но и увлечен дизайном и юзабилити, всегда готов к новым вызовам и нестандартным задачам. Буду рад помочь воплотить Ваши идеи в жизнь и создать веб-сайт Вашей мечты.</p>
        <p class="highlight">Свяжитесь со мной прям сейчас, чтобы обсудить наш будущий проект!</p>
    </section>
    <div class="social-buttons">
            <a href="https://vk.com/id472345781" class="social-btn vk" target="_blank">
                <img src="icons/vk-icon.png" alt="VK"> ВКонтакте
            </a>
            <a href="https://www.instagram.com/romaizumrudov?igsh=azZsZ2lvdHB2c24y" class="social-btn instagram" target="_blank">
                <img src="icons/instagram-icon.png" alt="Instagram"> Инстаграм
            </a>
            <a href="https://t.me/pelemexa" class="social-btn telegram" target="_blank">
                <img src="icons/telegram-icon.png" alt="Telegram"> Телеграмм
            </a>
            <a href="https://github.com/pelemexa2478" class="social-btn github" target="_blank">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg> GitHub
            </a>
        </div>

    <h3 class="skills-title">Мои навыки</h3>
    <div class="icon-block">
    <div class="tooltip">
    <img src="icons/html.png" class="icon" alt="HTML">
    <span class="tooltiptext">HTML</span>
    </div>
    <div class="tooltip">
    <img src="icons/css.png" class="icon" alt="css">
    <span class="tooltiptext">CSS</span>
    </div>
    <div class="tooltip">
    <img src="icons/bootstrap.png" class="icon" alt="BOOTSTRAP">
    <span class="tooltiptext">BOOTSTRAP</span>
    </div>
    <div class="tooltip">
    <img src="icons/php.png" class="icon" alt="php">
    <span class="tooltiptext">PHP</span>
    </div>
    <div class="tooltip">
    <img src="icons/javascript.png" class="icon" alt="javascript">
    <span class="tooltiptext">java script</span>
    </div>
    <div class="tooltip">
    <img src="icons/python.png" class="icon" alt="python">
    <span class="tooltiptext">python</span>
    </div>
    <div class="tooltip">
    <img src="icons/docker.png" class="icon" alt="docker">
    <span class="tooltiptext">docker</span>
    </div>
    <div class="tooltip">
    <img src="icons/c.png" class="icon" alt="C">
    <span class="tooltiptext">C#</span>
    </div>
    <div class="tooltip">
    <img src="icons/c++.png" class="icon" alt="c++">
    <span class="tooltiptext">c++</span>
    </div>
    <div class="tooltip">
    <img src="icons/unity.png" class="icon" alt="unity">
    <span class="tooltiptext">unity</span>
    </div>
    <div class="tooltip">
    <img src="icons/git.png" class="icon" alt="git">
    <span class="tooltiptext">git</span>
    </div>
    <div class="tooltip">
    <img src="icons/sql.png" class="icon" alt="sql">
    <span class="tooltiptext">sql</span>
    </div>
    <div class="tooltip">
    <img src="icons/photoshop.png" class="icon" alt="photoshop">
    <span class="tooltiptext">photoshop</span>
    </div>
    <div class="tooltip">
    <img src="icons/laravel.png" class="icon" alt="laravel">
    <span class="tooltiptext">laravel</span>
    </div>    
    </div>

    <h3 class="skills-title">Портфолио</h3>
    <div class="block-img" id="portfolio">
        <a href="img/1.png" data-fancybox="gallery">
            <img src="img/1mini.png"/>
            <div class="portfolio-overlay">Подробнее</div>
        </a>
        <a href="img/2.png" data-fancybox="gallery">
            <img src="img/2mini.png"/>
            <div class="portfolio-overlay">Подробнее</div>
        </a>
        <a href="img/3.png" data-fancybox="gallery">
            <img src="img/3mini.png"/>
            <div class="portfolio-overlay">Подробнее</div>
        </a>
        <a href="img/4.png" data-fancybox="gallery">
            <img src="img/4mini.png"/>
            <div class="portfolio-overlay">Подробнее</div>
        </a>
        <a href="img/drivingschool.png" data-fancybox="gallery">
            <img src="img/drivingschool-small.png"/>
            <div class="portfolio-overlay">Подробнее</div>
        </a>
    </div>

    <h3 class="skills-title">Связаться со мной</h3>
    
    <div class="contact-form" id="contact">
        <div id="form-message" style="display: none; padding: 15px; margin-bottom: 20px; border-radius: 8px; text-align: center;"></div>
        <form id="contact-form" action="send.php" method="POST">
            <div class="form-group">
                <input type="text" name="name" id="form-name" placeholder="Ваше имя" required>
            </div>
            <div class="form-group">
                <input type="email" name="email" id="form-email" placeholder="Ваш email" required>
            </div>
            <div class="form-group">
                <textarea name="message" id="form-message-text" placeholder="Ваше сообщение" required></textarea>
            </div>
            <button type="submit" class="submit-btn" id="submit-btn">Отправить сообщение</button>
        </form>
    </div>
    
</main>
</body>
</html>
