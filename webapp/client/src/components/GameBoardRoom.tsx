import { useEffect, useRef } from 'react';
import { useTelegram } from '../hooks/useTelegram';
import { useGameSocket } from '../hooks/useGameSocket';
import type { TicketMatrix } from '../types';
import LobbyOverlay from './LobbyOverlay';
import BoardStatsBar from './BoardStatsBar';
import CalledBoardPanel from './CalledBoardPanel';
import LiveCallPanel from './LiveCallPanel';
import GameOverOverlay from './GameOverOverlay';

interface Props {
  stake: number;
  myNumbers: number[];
  ticketMatrix: TicketMatrix;
  onExit: () => void;
}

export default function GameBoardRoom({ stake, myNumbers, ticketMatrix, onExit }: Props) {
  const tg = useTelegram();
  const { state, autoMark, setAutoMark, join, leave, hintSecondsLeft } = useGameSocket(tg, onExit);
  const joinedRef = useRef(false);

  useEffect(() => {
    if (joinedRef.current) return;
    joinedRef.current = true;
    join(stake, myNumbers, tg.initData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleBack = () => {
    leave();
    onExit();
  };

  return (
    <div id="playing-page" className="game-board-room">
      <LobbyOverlay
        visible={state.lobbyVisible}
        statusText={state.lobbyStatusText}
        players={state.lobbyPlayers}
        myUserId={state.myUserId}
        countdownVisible={state.countdownVisible}
        countdownSeconds={state.countdownSeconds}
      />

      <BoardStatsBar
        gameId={state.gameId}
        playersCount={state.playersCount}
        stake={stake}
        calledCount={state.calledCount}
        onBack={handleBack}
      />

      <div className="board-room-body">
        <CalledBoardPanel calledNumbers={state.calledNumbers} currentBall={state.currentBall} />

        <LiveCallPanel
          calledCount={state.calledCount}
          currentBall={state.currentBall}
          currentBallLetter={state.currentBallLetter}
          ballAnimKey={state.ballAnimKey}
          ballHistory={state.ballHistory}
          autoMark={autoMark}
          onAutoMarkChange={setAutoMark}
          boardStatusText={state.boardStatusText}
          matchCount={state.matchCount}
          myNumbers={myNumbers}
          ticketMatrix={ticketMatrix}
          matchedNumbers={state.matchedNumbers}
          playingBalance={state.playingBalance}
        />
      </div>

      <GameOverOverlay gameOver={state.gameOver} hintSecondsLeft={hintSecondsLeft} />
    </div>
  );
}
