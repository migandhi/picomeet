// PicoMeet SFU — optional broadcast-only forwarder for large lecture rooms.
// Build:  cd sfu && go build -ldflags="-s -w" -o picosfu .   (~15 MB static binary, ~40 MB RSS)
// Enable: set PM_SFU_URL in .env and flip a room to mode=lecture-sfu.
package main
import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"
	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v3"
)
type Room struct {
	sync.RWMutex
	tracks map[string]*webrtc.TrackLocalStaticRTP // one publisher's tracks
	subs   map[*webrtc.PeerConnection]bool
}
var (
	rooms   = map[string]*Room{}
	roomsMu sync.Mutex
	up      = websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	cfgICE  = webrtc.Configuration{ICEServers: []webrtc.ICEServer{{URLs: []string{"stun:stun.l.google.com:19302"}}}}
)
func getRoom(id string) *Room {
	roomsMu.Lock()
	defer roomsMu.Unlock()
	if r, ok := rooms[id]; ok {
		return r
	}
	r := &Room{tracks: map[string]*webrtc.TrackLocalStaticRTP{}, subs: map[*webrtc.PeerConnection]bool{}}
	rooms[id] = r
	return r
}
type msg struct {
	Role string                    `json:"role"` // "pub" | "sub"
	Room string                    `json:"room"`
	SDP  webrtc.SessionDescription `json:"sdp"`
}
func main() {
	http.HandleFunc("/sfu", func(w http.ResponseWriter, r *http.Request) {
		c, err := up.Upgrade(w, r, nil)
		if err != nil { return }
		defer c.Close()
		var m msg
		if err := c.ReadJSON(&m); err != nil { return }
		room := getRoom(m.Room)
		pc, err := webrtc.NewPeerConnection(cfgICE)
		if err != nil { return }
		if m.Role == "pub" {
			pc.OnTrack(func(remote *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
				local, _ := webrtc.NewTrackLocalStaticRTP(remote.Codec().RTPCodecCapability,
					remote.ID(), remote.StreamID())
				room.Lock(); room.tracks[remote.ID()] = local; room.Unlock()
				// Keyframe pump for late subscribers.
				go func() {
					for range time.Tick(3 * time.Second) {
						_ = pc.WriteRTCP([]webrtc.RTCPPacket{}) // replace with PLI in production
					}
				}()
				buf := make([]byte, 1500)
				for {
					n, _, err := remote.Read(buf)
					if err != nil { return }
					if _, err = local.Write(buf[:n]); err != nil { return }
				}
			})
		} else {
			room.RLock()
			for _, t := range room.tracks { _, _ = pc.AddTrack(t) }
			room.RUnlock()
		}
		_ = pc.SetRemoteDescription(m.SDP)
		answer, _ := pc.CreateAnswer(nil)
		gather := webrtc.GatheringCompletePromise(pc)
		_ = pc.SetLocalDescription(answer)
		<-gather
		_ = c.WriteJSON(map[string]any{"sdp": pc.LocalDescription()})
		// Keep the socket alive until the peer disconnects.
		for { if _, _, err := c.ReadMessage(); err != nil { pc.Close(); return } }
	})
	log.Println("picosfu on :7000")
	log.Fatal(http.ListenAndServe("127.0.0.1:7000", nil))
}

(Reference implementation — see sfu/README.md for the bandwidth budget guard you must add before exposing it publicly.)

4. Automated Ubuntu Installation Script
