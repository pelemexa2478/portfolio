<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';

if (isset($_GET['panel']) && $_GET['panel'] === ADMIN_PANEL_QUERY) {
    define('ADMIN_ENTRY', true);
    require __DIR__ . '/admin.php';
    exit;
}

$portfolioItems = loadPortfolioItems();

include 'header.php';
?>
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

    function markVideoOrientation(videoElement) {
        if (!videoElement || !videoElement.videoWidth || !videoElement.videoHeight) {
            return;
        }

        var isPortrait = videoElement.videoHeight > videoElement.videoWidth;
        var $card = $(videoElement).closest('.video-card');

        if ($card.length) {
            $card.toggleClass('is-portrait', isPortrait);
        }
    }

    function loadPortfolioVideo(videoElement) {
        if (!videoElement) {
            return;
        }

        var $video = $(videoElement);
        if ($video.data('videoLoaded')) {
            return;
        }

        var source = $video.data('video-src');
        if (!source) {
            return;
        }

        videoElement.src = source;
        videoElement.load();
        $video.data('videoLoaded', true);
        videoElement.dataset.loaded = 'true';

        if (videoElement.readyState >= 1) {
            markVideoOrientation(videoElement);
        } else {
            videoElement.addEventListener('loadedmetadata', function handleMeta() {
                markVideoOrientation(videoElement);
            }, { once: true });
        }

        videoElement.addEventListener('loadeddata', function handleLoaded() {
            if ($video.data('loop')) {
                videoElement.loop = true;
            }
            if ($video.data('autoplay')) {
                var playPromise = videoElement.play();
                if (playPromise && playPromise.catch) {
                    playPromise.catch(function() {});
                }
            }
        }, { once: true });
    }

    function initPortfolioVideoLoading() {
        var videos = document.querySelectorAll('.portfolio-item video[data-video-src]');
        if (!videos.length) {
            return;
        }

        if ('IntersectionObserver' in window) {
            var observer = new IntersectionObserver(function(entries) {
                entries.forEach(function(entry) {
                    if (entry.isIntersecting) {
                        loadPortfolioVideo(entry.target);
                        observer.unobserve(entry.target);
                    }
                });
            }, { threshold: 0.4 });

            Array.prototype.forEach.call(videos, function(video) {
                observer.observe(video);
            });
        } else {
            Array.prototype.forEach.call(videos, function(video) {
                loadPortfolioVideo(video);
            });
        }
    }

    function initPortfolioDescriptionInteractions() {
        var prefersTouch = window.matchMedia('(hover: none)').matches;
        if (!prefersTouch) {
            return;
        }

        var $grid = $('.block-img');
        if (!$grid.length) {
            return;
        }

        var activeItem = null;

        function hideActiveDescription() {
            if (activeItem) {
                activeItem.removeClass('show-description');
                activeItem = null;
            }
        }

        $grid.on('click', '.portfolio-info-chip', function(e) {
            e.preventDefault();
            e.stopPropagation();

            var $item = $(this).closest('.portfolio-item');
            var hasDescription = $item.data('has-description') === true || $item.data('has-description') === 'true';
            if (!hasDescription) {
                hideActiveDescription();
                return;
            }

            if (!$item.hasClass('show-description')) {
                hideActiveDescription();
                $item.addClass('show-description');
                activeItem = $item;
            } else {
                hideActiveDescription();
            }
        });

        $(document).on('click touchstart', function(e) {
            if (!activeItem) {
                return;
            }

            var $target = $(e.target);
            if ($target.closest('.portfolio-item').get(0) !== activeItem.get(0)) {
                hideActiveDescription();
            }
        });
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

    $('.portfolio-filter .filter-btn').on('click', function() {
        var filter = $(this).data('filter');

        $('.portfolio-filter .filter-btn').removeClass('active');
        $(this).addClass('active');

        $('.block-img .portfolio-item').each(function() {
            var $item = $(this);
            var category = $item.data('category');
            var videoElement;

            if (filter === 'all' || category === filter) {
                $item.removeClass('hidden');
                videoElement = $item.find('video[data-video-src]').get(0);
                if (videoElement) {
                    loadPortfolioVideo(videoElement);
                }
            } else {
                $item.addClass('hidden');
                videoElement = $item.find('video').get(0);
                if (videoElement) {
                    videoElement.pause();
                    try {
                        videoElement.currentTime = 0;
                    } catch (e) {}
                }
            }
        });
    });

    initPortfolioVideoLoading();
    initPortfolioDescriptionInteractions();

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
    <div class="portfolio-filter" role="group" aria-label="Фильтр работ">
        <button type="button" class="filter-btn active" data-filter="all">Все работы</button>
        <button type="button" class="filter-btn" data-filter="sites">Сайты</button>
        <button type="button" class="filter-btn" data-filter="games">Игры</button>
        <button type="button" class="filter-btn" data-filter="other">Прочее</button>
    </div>
    <div class="block-img" id="portfolio">
        <?php if (empty($portfolioItems)): ?>
            <div class="portfolio-empty">
                <p>Здесь пока нет работ. Добавьте первую через панель управления.</p>
            </div>
        <?php else: ?>
            <?php foreach ($portfolioItems as $item): ?>
                <?php
                    $type = $item['type'] ?? 'image';
                    $category = htmlspecialchars($item['category'] ?? 'other', ENT_QUOTES, 'UTF-8');
                    $title = htmlspecialchars($item['title'] ?? 'Работа', ENT_QUOTES, 'UTF-8');
                    $overlayText = htmlspecialchars(
                        $item['overlay'] ?? ($type === 'video' ? 'Смотреть игру' : 'Подробнее'),
                        ENT_QUOTES,
                        'UTF-8'
                    );
                    $fullSource = htmlspecialchars($item['full'] ?? '', ENT_QUOTES, 'UTF-8');
                    $thumbSourceRaw = $item['thumb'] ?? $item['full'] ?? '';
                    $thumbSource = htmlspecialchars($thumbSourceRaw ?? '', ENT_QUOTES, 'UTF-8');
                    $dataThumbAttr = $thumbSource ? ' data-thumb="' . $thumbSource . '"' : '';
                    $descriptionRaw = trim((string)($item['description'] ?? ''));
                    $hasDescription = $descriptionRaw !== '';
                    $descriptionEscaped = htmlspecialchars($descriptionRaw, ENT_QUOTES, 'UTF-8');
                    $descriptionHtml = $hasDescription ? nl2br($descriptionEscaped) : '';
                    $descriptionAttr = ' data-has-description="' . ($hasDescription ? 'true' : 'false') . '"';
                ?>
                <?php if ($type === 'video'): ?>
                    <a href="<?= $fullSource; ?>" data-fancybox="gallery" data-type="video" class="portfolio-item video-card" data-category="<?= $category; ?>"<?= $dataThumbAttr; ?><?= $descriptionAttr; ?>>
                        <video
                            class="portfolio-video"
                            data-video-src="<?= $fullSource; ?>"
                            data-autoplay="<?= !empty($item['autoplay']) ? 'true' : 'false'; ?>"
                            data-loop="<?= !empty($item['loop']) ? 'true' : 'false'; ?>"
                            muted
                            playsinline
                            preload="none"
                            <?= $thumbSource ? 'poster="' . $thumbSource . '"' : ''; ?>
                        ></video>
                        <div class="portfolio-overlay"><?= $overlayText; ?></div>
                        <?php if ($hasDescription): ?>
                            <button class="portfolio-info-chip" type="button" aria-label="Описание работы">
                                i
                            </button>
                            <div class="portfolio-description" role="presentation">
                                <div class="portfolio-description__inner"><?= $descriptionHtml; ?></div>
                            </div>
                        <?php endif; ?>
                    </a>
                <?php else: ?>
                    <a href="<?= $fullSource; ?>" data-fancybox="gallery" class="portfolio-item" data-category="<?= $category; ?>"<?= $dataThumbAttr; ?><?= $descriptionAttr; ?>>
                        <img src="<?= $thumbSource; ?>" alt="<?= $title; ?>" loading="lazy"/>
                        <div class="portfolio-overlay"><?= $overlayText; ?></div>
                        <?php if ($hasDescription): ?>
                            <button class="portfolio-info-chip" type="button" aria-label="Описание работы">
                                i
                            </button>
                            <div class="portfolio-description" role="presentation">
                                <div class="portfolio-description__inner"><?= $descriptionHtml; ?></div>
                            </div>
                        <?php endif; ?>
                    </a>
                <?php endif; ?>
            <?php endforeach; ?>
        <?php endif; ?>
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
