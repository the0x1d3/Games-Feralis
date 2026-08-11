import { GAME_HEIGHT, GAME_WIDTH } from '@engine/config';
import { Phaser } from '@engine/phaser';
import { onLocaleChange, t } from '@i18n/index';

/**
 * Scena minima della Fase 0: dimostra che il canvas vive e che il testo
 * disegnato dentro Phaser passa comunque da i18n.
 *
 * La divisione di ruoli fissata dal PDR §6.1 e' gia' visibile: qui c'e' solo il
 * MONDO (canvas), mentre pannelli, menu e diagnostica sono DOM e stanno in
 * src/ui/. Nessuna regola di gioco entra in una scena.
 */
export class BootScene extends Phaser.Scene {
  static readonly KEY = 'boot';

  private title?: Phaser.GameObjects.Text;
  private caption?: Phaser.GameObjects.Text;

  constructor() {
    super({ key: BootScene.KEY });
  }

  create(): void {
    const centerX = GAME_WIDTH / 2;
    const centerY = GAME_HEIGHT / 2;

    const panel = this.add.rectangle(centerX, centerY, GAME_WIDTH - 120, 150, 0x16241d, 1);
    panel.setStrokeStyle(2, 0x3f8a63);

    this.title = this.add
      .text(centerX, centerY - 26, t('app.title'), {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '44px',
        color: '#eaf6ef',
      })
      .setOrigin(0.5);

    this.caption = this.add
      .text(centerX, centerY + 30, t('boot.canvasAlive'), {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '14px',
        color: '#8fb9a2',
        align: 'center',
        wordWrap: { width: GAME_WIDTH - 160 },
      })
      .setOrigin(0.5);

    // Un respiro lentissimo: serve solo a rendere evidente che il game loop gira.
    this.tweens.add({
      targets: panel,
      scaleX: 1.015,
      scaleY: 1.04,
      duration: 2600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Il testo dentro al canvas segue il cambio lingua come quello nel DOM.
    // La disiscrizione all'evento SHUTDOWN e' la disciplina anti-leak del PDR §7.1:
    // si scrive adesso che c'e' un listener solo, non quando saranno duecento.
    const unsubscribe = onLocaleChange(() => {
      this.refreshText();
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);
  }

  private refreshText(): void {
    this.title?.setText(t('app.title'));
    this.caption?.setText(t('boot.canvasAlive'));
  }
}
